import { computeBadge } from "./lib/badge.ts";
import {
  COUNT_LABEL,
  GMAIL_SCOPE,
  GOOGLE_CLIENT_ID,
  MAX_PREVIEW_THREADS,
  POLL_MINUTES,
  SCOPES,
  TOKEN_EXPIRY_MARGIN_MS,
} from "./lib/config.ts";
import {
  AuthError,
  fetchEmail,
  fetchMessageBody,
  fetchThreadSummary,
  fetchUnreadCount,
  gmailUrl,
  listUnreadThreads,
  MISSING_GMAIL_ACCESS,
  modifyThread,
  PermissionError,
} from "./lib/gmail.ts";
import { buildAuthUrl, needsInteraction, parseAuthRedirect } from "./lib/oauth.ts";
import { inboxToOpenDirectly, mergeThreads, removeThread, threadsToFetch } from "./lib/state.ts";
import type { AccountState, Message, Reply, ThreadSummary, Token } from "./lib/types.ts";

const ALARM = "poll";
const MENU_ACCOUNTS = "accounts";
const MENU_OPEN_PREFIX = "open:";

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
  await Promise.all([updateBadge(states), updateActionMode(states), updateMenu(states)]);
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

/**
 * Nothing unread → no popup, so a click fires action.onClicked and opens Gmail.
 * Unread mail or a problem → the popup.
 */
async function updateActionMode(states: AccountState[]): Promise<void> {
  await chrome.action.setPopup({ popup: inboxToOpenDirectly(states) ? "" : "popup.html" });
}

let menuKey = "";

/** Right-click menu on the toolbar icon: open any inbox, or manage accounts. */
async function updateMenu(states: AccountState[]): Promise<void> {
  const key = states.map((s) => s.email).join("\n");
  if (key === menuKey) return;
  menuKey = key;
  await chrome.contextMenus.removeAll();
  for (const s of states) {
    chrome.contextMenus.create({
      id: `${MENU_OPEN_PREFIX}${s.email}`,
      title: `Open ${s.email}`,
      contexts: ["action"],
    });
  }
  chrome.contextMenus.create({
    id: MENU_ACCOUNTS,
    title: "Accounts…",
    contexts: ["action"],
  });
}

/** Shows the popup even when a click would normally open Gmail. */
async function showPopup(): Promise<void> {
  await chrome.action.setPopup({ popup: "popup.html" });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 420,
      height: 600,
    });
  }
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
  return { accessToken: result.accessToken, expiresAt: result.expiresAt, scopes: result.scopes };
}

/** Google can hand back a token without Gmail access if its checkbox was left unticked. */
function assertGmailScope(token: Token): void {
  if (token.scopes && !token.scopes.includes(GMAIL_SCOPE)) {
    throw new PermissionError(MISSING_GMAIL_ACCESS);
  }
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

/** Runs `fn` with a valid token, renewing it once if Google rejects it. */
async function withToken<T>(email: string, fn: (accessToken: string) => Promise<T>): Promise<T> {
  let token = await validToken(email);
  assertGmailScope(token);
  try {
    return await fn(token.accessToken);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    token = await silentToken(email);
    assertGmailScope(token);
    return fn(token.accessToken);
  }
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

async function loadThreads(
  accessToken: string,
  previous: ThreadSummary[] | undefined,
): Promise<ThreadSummary[]> {
  const listed = await listUnreadThreads(accessToken, COUNT_LABEL, MAX_PREVIEW_THREADS);
  const results = await Promise.allSettled(
    threadsToFetch(listed, previous).map((id) => fetchThreadSummary(accessToken, id)),
  );
  const fetched = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  return mergeThreads(listed, previous, fetched);
}

async function checkAccount(
  email: string,
  previous: AccountState | undefined,
): Promise<AccountState> {
  const checkedAt = Date.now();
  try {
    const { unread, threads } = await withToken(email, async (accessToken) => {
      const unread = await fetchUnreadCount(accessToken, COUNT_LABEL);
      const threads = unread > 0 ? await loadThreads(accessToken, previous?.threads) : [];
      return { unread, threads };
    });
    return { email, status: "ok", unread, threads, checkedAt };
  } catch (e) {
    if (e instanceof PermissionError) {
      await setToken(email, undefined);
      return { email, status: "needs-auth", unread: null, error: e.message, checkedAt };
    }
    if (e instanceof InteractionRequired || e instanceof AuthError) {
      await setToken(email, undefined);
      return {
        email,
        status: "needs-auth",
        unread: null,
        error: "Google needs you to sign in again. Click Reconnect.",
        checkedAt,
      };
    }
    // Network trouble etc.: keep the last known state.
    return {
      email,
      status: "error",
      unread: previous?.unread ?? null,
      ...(previous?.threads ? { threads: previous.threads } : {}),
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

async function openTab(url: string): Promise<void> {
  await chrome.tabs.create({ url });
}

async function handle(message: Message): Promise<unknown> {
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
      return openTab(gmailUrl(message.email));
    case "open-thread":
      return openTab(gmailUrl(message.email, message.threadId));
    case "thread-action": {
      const { email, threadId, action } = message;
      await withToken(email, (t) => modifyThread(t, threadId, action));
      await setStates(removeThread(await getStates(), email, threadId));
      void refreshAll();
      return;
    }
    case "get-body":
      return withToken(message.email, (t) => fetchMessageBody(t, message.messageId));
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  menuKey = "\0"; // force a rebuild
  void ensureAlarm().then(getStates).then(updateMenu).then(refreshAll);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().then(refreshAll);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshAll();
});

// Fires only when no popup is set, i.e. nothing is unread.
chrome.action.onClicked.addListener(() => {
  void getStates().then((states) => {
    const email = inboxToOpenDirectly(states);
    return email ? openTab(gmailUrl(email)) : showPopup();
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const id = String(info.menuItemId);
  if (id === MENU_ACCOUNTS) void showPopup();
  else if (id.startsWith(MENU_OPEN_PREFIX))
    void openTab(gmailUrl(id.slice(MENU_OPEN_PREFIX.length)));
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(
    (data) => sendResponse({ ok: true, data } satisfies Reply),
    (e: unknown) =>
      sendResponse({
        ok: false,
        error:
          e instanceof InteractionRequired || e instanceof AuthError
            ? "Google needs you to sign in again. Click Reconnect."
            : errorMessage(e),
      } satisfies Reply),
  );
  return true; // reply asynchronously
});

// Other devices add accounts through storage.sync; pick them up right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.emails) void refreshAll();
});
