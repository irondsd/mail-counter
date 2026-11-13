import { computeBadge } from "./lib/badge.ts";
import {
  COUNT_LABEL,
  GOOGLE_CLIENT_ID,
  POLL_MINUTES,
  SCOPES,
  TOKEN_EXPIRY_MARGIN_MS,
} from "./lib/config.ts";
import { AuthError, fetchEmail, fetchUnreadCount, gmailUrl } from "./lib/gmail.ts";
import { buildAuthUrl, needsInteraction, parseAuthRedirect } from "./lib/oauth.ts";
import type { AccountState, Message, Reply, Token } from "./lib/types.ts";

const ALARM = "poll";

/** Silent sign-in isn't possible; the user has to click "Reconnect". */
class InteractionRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionRequired";
  }
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Storage
//   sync:  emails   – which accounts to watch (follows you to other devices)
//   local: tokens   – short-lived access tokens, per device
//          accounts – last known state, rendered by the popup and badge
// ---------------------------------------------------------------------------

async function getEmails(): Promise<string[]> {
  const { emails } = await chrome.storage.sync.get("emails");
  return Array.isArray(emails) ? (emails as string[]) : [];
}

async function setEmails(emails: string[]): Promise<void> {
  await chrome.storage.sync.set({ emails });
}

async function getTokens(): Promise<Record<string, Token>> {
  const { tokens } = await chrome.storage.local.get("tokens");
  return (tokens as Record<string, Token> | undefined) ?? {};
}

async function setToken(email: string, token: Token | undefined): Promise<void> {
  const tokens = await getTokens();
  if (token) tokens[email] = token;
  else delete tokens[email];
  await chrome.storage.local.set({ tokens });
}

async function getStates(): Promise<AccountState[]> {
  const { accounts } = await chrome.storage.local.get("accounts");
  return (accounts as AccountState[] | undefined) ?? [];
}

async function setStates(states: AccountState[]): Promise<void> {
  await chrome.storage.local.set({ accounts: states });
  await updateBadge(states);
}

async function updateBadge(states: AccountState[]): Promise<void> {
  const badge = computeBadge(states);
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
    chrome.action.setTitle({ title: badge.title }),
  ]);
}

// ---------------------------------------------------------------------------
// Auth: OAuth implicit flow through chrome.identity.launchWebAuthFlow.
// It only reads your Google session; it never signs you in or out.
// ---------------------------------------------------------------------------

async function authorize(interactive: boolean, loginHint?: string): Promise<Token> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("No OAuth client ID. Put PUBLIC_GOOGLE_CLIENT_ID in .env and rebuild.");
  }
  const state = crypto.randomUUID();
  const url = buildAuthUrl({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri: chrome.identity.getRedirectURL(),
    scopes: SCOPES,
    state,
    loginHint,
    interactive,
  });

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url,
      interactive,
      // Google may redirect via JavaScript; give it time instead of bailing on first load.
      abortOnLoadForNonInteractive: false,
      timeoutMsForNonInteractive: 15_000,
    });
  } catch (e) {
    if (!interactive) throw new InteractionRequired(errorMessage(e));
    throw e;
  }
  if (!redirect) throw new Error("Sign-in was cancelled");

  const result = parseAuthRedirect(redirect, state);
  if (!result.ok) {
    if (needsInteraction(result.error)) throw new InteractionRequired(result.error);
    throw new Error(`Google sign-in failed: ${result.error}`);
  }
  return { accessToken: result.accessToken, expiresAt: result.expiresAt };
}

/** Gets a fresh token for `email` without any UI, and checks it's for the right account. */
async function silentToken(email: string): Promise<Token> {
  const token = await authorize(false, email);
  const actual = await fetchEmail(token.accessToken);
  if (actual !== email) {
    throw new InteractionRequired(`Google returned a token for ${actual}`);
  }
  await setToken(email, token);
  return token;
}

async function validToken(email: string): Promise<Token> {
  const token = (await getTokens())[email];
  if (token && token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) return token;
  return silentToken(email);
}

/** Interactive sign-in. Without a hint, Google shows the account chooser. */
async function connect(loginHint?: string): Promise<void> {
  const token = await authorize(true, loginHint);
  const email = await fetchEmail(token.accessToken);
  await setToken(email, token);
  const emails = await getEmails();
  if (!emails.includes(email)) await setEmails([...emails, email]);
  await refreshAll();
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function checkAccount(
  email: string,
  previous: AccountState | undefined,
): Promise<AccountState> {
  const checkedAt = Date.now();
  try {
    let token = await validToken(email);
    let unread: number;
    try {
      unread = await fetchUnreadCount(token.accessToken, COUNT_LABEL);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      token = await silentToken(email);
      unread = await fetchUnreadCount(token.accessToken, COUNT_LABEL);
    }
    return { email, status: "ok", unread, checkedAt };
  } catch (e) {
    if (e instanceof InteractionRequired || e instanceof AuthError) {
      await setToken(email, undefined);
      return { email, status: "needs-auth", unread: null, error: e.message, checkedAt };
    }
    // Network trouble etc.: keep the last known count.
    return {
      email,
      status: "error",
      unread: previous?.unread ?? null,
      error: errorMessage(e),
      checkedAt,
    };
  }
}

async function doRefresh(): Promise<void> {
  const [emails, previous] = await Promise.all([getEmails(), getStates()]);
  const states = await Promise.all(
    emails.map((email) =>
      checkAccount(
        email,
        previous.find((p) => p.email === email),
      ),
    ),
  );
  await setStates(states);
}

let running: Promise<void> | null = null;
let rerun = false;

/** Runs one refresh at a time; a request during a run schedules one more. */
function refreshAll(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await doRefresh();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function remove(email: string): Promise<void> {
  await setEmails((await getEmails()).filter((e) => e !== email));
  await setToken(email, undefined);
  await setStates((await getStates()).filter((s) => s.email !== email));
}

async function ensureAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm || alarm.periodInMinutes !== POLL_MINUTES) {
    await chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  }
}

async function handle(message: Message): Promise<void> {
  switch (message.type) {
    case "add-account":
      return connect();
    case "reconnect":
      return connect(message.email);
    case "remove":
      return remove(message.email);
    case "refresh":
      return refreshAll();
    case "open":
      await chrome.tabs.create({ url: gmailUrl(message.email) });
      return;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm().then(refreshAll);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().then(refreshAll);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshAll();
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(
    () => sendResponse({ ok: true } satisfies Reply),
    (e: unknown) => sendResponse({ ok: false, error: errorMessage(e) } satisfies Reply),
  );
  return true; // reply asynchronously
});

// Other devices add accounts through storage.sync; pick them up right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.emails) void refreshAll();
});
