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
import { MENU_OPEN_PREFIX, MENU_POPUP, MENU_REFRESH, menuItems } from "./lib/menu.ts";
import { buildAuthUrl, needsInteraction, parseAuthRedirect } from "./lib/oauth.ts";
import { intervalFor, normalizeSettings, type Settings } from "./lib/settings.ts";
import {
  inboxToOpenDirectly,
  isDue,
  mergeThreads,
  msUntilNextCheck,
  newMailArrived,
  removeThread,
  threadsToFetch,
} from "./lib/state.ts";
import type {
  AccountState,
  Message,
  OffscreenMessage,
  Reply,
  ThreadSummary,
  Token,
} from "./lib/types.ts";

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
//          settings – sound and per-account check intervals (options page)
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

async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get("settings");
  return normalizeSettings(settings);
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
  await Promise.all([
    updateBadge(states),
    updateActionMode(states, await getSettings()),
    updateMenu(states),
  ]);
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
 * Nothing unread → no popup (unless the options say to keep it), so a click fires
 * action.onClicked and opens Gmail. Unread mail or a problem → the popup.
 */
async function updateActionMode(states: AccountState[], settings: Settings): Promise<void> {
  const direct = settings.emptyClick === "gmail" && inboxToOpenDirectly(states);
  await chrome.action.setPopup({ popup: direct ? "" : "popup.html" });
}

let menuKey: string | null = null;

/**
 * Right-click menu on the toolbar icon: open any inbox, check all accounts now, or open the
 * popup. Chrome adds "Options" itself.
 */
async function updateMenu(states: AccountState[]): Promise<void> {
  const key = states.map((s) => s.email).join("\n");
  if (key === menuKey) return;
  menuKey = key;
  await chrome.contextMenus.removeAll();
  for (const item of menuItems(states.map((s) => s.email))) {
    chrome.contextMenus.create({ ...item, contexts: ["action"] });
  }
}

/**
 * Opens the popup from the menu. With nothing unread the icon may have no popup (a click opens
 * Gmail instead), so set it first; both calls go out together and Chrome runs them in order.
 * The usual click behaviour comes back once the popup is open.
 */
async function openPopup(windowId?: number): Promise<void> {
  void chrome.action.setPopup({ popup: "popup.html" });
  try {
    await chrome.action.openPopup(windowId === undefined ? undefined : { windowId });
  } catch (e) {
    console.warn("Couldn't open the popup:", e);
  } finally {
    const [states, settings] = await Promise.all([getStates(), getSettings()]);
    await updateActionMode(states, settings);
  }
}

// ---------------------------------------------------------------------------
// Sound: service workers can't play audio, so an offscreen document does.
// ---------------------------------------------------------------------------

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Play a short chime when new mail arrives",
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function chime(settings: Settings): Promise<void> {
  if (!settings.sound || settings.volume <= 0) return;
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "chime",
      volume: settings.volume,
    } satisfies OffscreenMessage);
  } catch (e) {
    console.warn("Couldn't play the new-mail sound:", e);
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
  await refreshAll(true, email);
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

/**
 * Checks the accounts that are due (all of them when `force`), keeping the rest as they were.
 * `quietFor` is an account that was just connected: its existing mail isn't "new".
 */
async function doRefresh(force: boolean, quietFor?: string): Promise<void> {
  const [emails, previous, settings] = await Promise.all([getEmails(), getStates(), getSettings()]);
  const now = Date.now();
  const states = await Promise.all(
    emails.map((email) => {
      const before = previous.find((p) => p.email === email);
      const due = force || !before || isDue(before.checkedAt, intervalFor(settings, email), now);
      return due ? checkAccount(email, before) : before;
    }),
  );
  await setStates(states);
  const comparable = previous.filter((p) => p.email !== quietFor);
  if (newMailArrived(comparable, states)) await chime(settings);
}

let running: Promise<void> | null = null;
let queued: { force: boolean; quietFor?: string } | null = null;

/** Runs one refresh at a time; requests during a run are merged into one more. */
function refreshAll(force = true, quietFor?: string): Promise<void> {
  if (running) {
    queued = {
      force: force || (queued?.force ?? false),
      quietFor: quietFor ?? queued?.quietFor,
    };
    return running;
  }
  running = (async () => {
    let next: typeof queued = { force, quietFor };
    while (next) {
      queued = null;
      await doRefresh(next.force, next.quietFor);
      next = queued;
    }
  })().finally(() => {
    running = null;
    void scheduleNext();
  });
  return running;
}

// ---------------------------------------------------------------------------
// Scheduling. Chrome alarms can't fire more often than every 30 seconds, so a timer wakes us
// for the next account that's due. Each check calls extension APIs, which keeps the service
// worker alive between short intervals; if Chrome stops it anyway, the alarm restarts the cycle.
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;

async function scheduleNext(): Promise<void> {
  clearTimeout(timer);
  const [states, settings] = await Promise.all([getStates(), getSettings()]);
  const wait = msUntilNextCheck(
    states.map((s) => ({
      checkedAt: s.checkedAt,
      intervalSeconds: intervalFor(settings, s.email),
    })),
    Date.now(),
  );
  if (wait === null || running) return;
  timer = setTimeout(() => void refreshAll(false), Math.max(1_000, wait));
}

async function remove(email: string): Promise<void> {
  await setEmails((await getEmails()).filter((e) => e !== email));
  const settings = await getSettings();
  if (email in settings.checkEvery) {
    delete settings.checkEvery[email];
    await chrome.storage.sync.set({ settings });
  }
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
  menuKey = null; // force a rebuild
  void ensureAlarm()
    .then(getStates)
    .then(updateMenu)
    .then(() => refreshAll());
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().then(() => refreshAll());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshAll(false);
});

// Fires only when no popup is set: nothing is unread and the options say to open Gmail.
chrome.action.onClicked.addListener(() => {
  void getStates().then((states) => {
    const email = inboxToOpenDirectly(states);
    return email ? openTab(gmailUrl(email)) : chrome.runtime.openOptionsPage();
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === MENU_REFRESH) void refreshAll();
  else if (id === MENU_POPUP) void openPopup(tab?.windowId);
  else if (id.startsWith(MENU_OPEN_PREFIX))
    void openTab(gmailUrl(id.slice(MENU_OPEN_PREFIX.length)));
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if ((message as { target?: string }).target === "offscreen") return false;
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
  // A new interval applies right away, not after the current wait.
  if (area === "sync" && changes.settings) {
    void scheduleNext();
    void Promise.all([getStates(), getSettings()]).then(([states, settings]) =>
      updateActionMode(states, settings),
    );
  }
});
