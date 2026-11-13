import { formatCount } from "../lib/badge.ts";
import { GOOGLE_CLIENT_ID } from "../lib/config.ts";
import { buildPreviewDocument, formatDate, hasRemoteImages } from "../lib/preview.ts";
import { removeThread } from "../lib/state.ts";
import type {
  AccountState,
  Message,
  MessageBody,
  Reply,
  ThreadAction,
  ThreadSummary,
} from "../lib/types.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const listView = $("list-view");
const accountsEl = $("accounts");
const empty = $("empty");
const notice = $("notice");
const checked = $("checked");
const footer = document.querySelector("footer")!;
const refreshButton = $<HTMLButtonElement>("refresh");
const addButton = $<HTMLButtonElement>("add");
const accountTpl = $<HTMLTemplateElement>("account-tpl");
const threadTpl = $<HTMLTemplateElement>("thread-tpl");

const detailView = $("detail-view");
const detailActions = $("detail-actions");
const detailSubject = $("detail-subject");
const detailFrom = $("detail-from");
const detailDate = $("detail-date");
const detailStatus = $("detail-status");
const detailFrame = $<HTMLIFrameElement>("detail-frame");
const showImagesButton = $<HTMLButtonElement>("show-images");

let accounts: AccountState[] = [];
let detail: { email: string; thread: ThreadSummary; body?: MessageBody } | null = null;

const ACTIONS: { action: ThreadAction | "open"; icon: string; label: string }[] = [
  { action: "open", icon: "i-open", label: "Open in Gmail" },
  { action: "read", icon: "i-read", label: "Mark as read" },
  { action: "archive", icon: "i-archive", label: "Archive" },
  { action: "spam", icon: "i-spam", label: "Report spam" },
];

// ---------------------------------------------------------------------------

function showNotice(text: string | null): void {
  notice.hidden = !text;
  notice.textContent = text ?? "";
}

/** Sends a message to the background worker; errors show as a notice unless `quiet`. */
async function send<T = unknown>(message: Message, quiet = false): Promise<Reply<T>> {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply<T> | undefined;
  if (!reply) return { ok: false, error: "No answer from the extension" };
  if (!reply.ok && !quiet) showNotice(reply.error);
  return reply;
}

function el<T extends Element>(root: ParentNode, selector: string): T {
  return root.querySelector<T>(selector)!;
}

function actionButtons(email: string, thread: ThreadSummary): HTMLButtonElement[] {
  return ACTIONS.map(({ action, icon, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg><use href="#${icon}" /></svg>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (action === "open") void openThread(email, thread);
      else void runAction(email, thread, action);
    });
    return button;
  });
}

const totalThreads = () => accounts.reduce((n, a) => n + (a.threads?.length ?? 0), 0);
const allOk = () => accounts.every((a) => a.status === "ok");

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function renderThread(email: string, thread: ThreadSummary): HTMLLIElement {
  const li = threadTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  el(li, ".from").textContent =
    thread.count > 1 ? `${thread.fromName} (${thread.count})` : thread.fromName;
  el<HTMLElement>(li, ".from").title = thread.fromEmail;
  el(li, ".date").textContent = formatDate(thread.date);
  el(li, ".subject").textContent = thread.subject;
  el(li, ".snippet").textContent = thread.snippet;
  el(li, ".thread-main").addEventListener("click", () => void showDetail(email, thread));
  el(li, ".actions").append(...actionButtons(email, thread));
  return li;
}

function renderAccount(account: AccountState): HTMLElement {
  const section = accountTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const open = el<HTMLButtonElement>(section, ".account-open");
  const count = el<HTMLElement>(section, ".count");
  const error = el<HTMLElement>(section, ".account-error");
  const reconnect = el<HTMLButtonElement>(section, ".reconnect");
  const more = el<HTMLButtonElement>(section, ".more");

  el(section, ".email").textContent = account.email;
  open.title = `Open Gmail for ${account.email}`;
  open.addEventListener("click", () => {
    void send({ type: "open", email: account.email }).then(() => window.close());
  });

  const unread = account.unread ?? 0;
  if (account.status === "ok") {
    count.textContent = formatCount(unread);
    count.classList.toggle("has-unread", unread > 0);
  } else if (account.unread !== null) {
    count.textContent = formatCount(unread);
  }

  if (account.status !== "ok" && account.error) {
    error.textContent = account.error;
    error.hidden = false;
  }
  reconnect.hidden = account.status !== "needs-auth";
  reconnect.addEventListener("click", () => void send({ type: "reconnect", email: account.email }));

  el(section, ".remove").addEventListener("click", () => {
    if (confirm(`Stop watching ${account.email}?`)) {
      void send({ type: "remove", email: account.email });
    }
  });

  const threads = account.threads ?? [];
  el(section, ".threads").append(...threads.map((t) => renderThread(account.email, t)));

  const hidden = unread - threads.length;
  if (hidden > 0) {
    more.hidden = false;
    more.textContent = threads.length
      ? `${hidden} more unread in Gmail`
      : `${unread} unread. Open Gmail`;
    more.addEventListener("click", () => {
      void send({ type: "open", email: account.email }).then(() => window.close());
    });
  }
  return section;
}

function renderList(): void {
  accountsEl.replaceChildren(...accounts.map(renderAccount));
  empty.hidden = accounts.length > 0;
  const last = Math.max(0, ...accounts.map((a) => a.checkedAt ?? 0));
  checked.textContent = last ? `Checked ${formatDate(last)}` : "";
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function renderBody(allowImages: boolean): void {
  if (!detail?.body) return;
  detailFrame.srcdoc = buildPreviewDocument(detail.body, allowImages);
  detailFrame.hidden = false;
  detailStatus.hidden = true;
  showImagesButton.hidden = allowImages || !hasRemoteImages(detail.body.html);
}

async function showDetail(email: string, thread: ThreadSummary): Promise<void> {
  detail = { email, thread };
  listView.hidden = true;
  footer.hidden = true;
  detailView.hidden = false;

  detailSubject.textContent = thread.subject;
  detailFrom.textContent = thread.fromName;
  detailFrom.title = thread.fromEmail;
  detailDate.textContent = formatDate(thread.date);
  detailActions.replaceChildren(...actionButtons(email, thread));
  detailStatus.textContent = "Loading…";
  detailStatus.hidden = false;
  detailFrame.hidden = true;
  detailFrame.srcdoc = "";
  showImagesButton.hidden = true;

  const reply = await send<MessageBody>(
    { type: "get-body", email, messageId: thread.messageId },
    true, // the error shows in place of the body
  );
  if (detail?.thread.id !== thread.id) return; // went back or opened another
  if (!reply.ok || !reply.data) {
    detailStatus.textContent = reply.ok ? "Couldn't load this email." : reply.error;
    return;
  }
  detail.body = reply.data;
  renderBody(false);
}

function showList(): void {
  detail = null;
  detailFrame.srcdoc = "";
  detailView.hidden = true;
  listView.hidden = false;
  footer.hidden = false;
  renderList();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function openThread(email: string, thread: ThreadSummary): Promise<void> {
  await send({ type: "open-thread", email, threadId: thread.id });
  window.close();
}

async function runAction(
  email: string,
  thread: ThreadSummary,
  action: ThreadAction,
): Promise<void> {
  // Update right away; the background confirms (or reverts on the next refresh).
  accounts = removeThread(accounts, email, thread.id);
  showList();

  const reply = await send({ type: "thread-action", email, threadId: thread.id, action });
  if (!reply.ok) {
    void send({ type: "refresh" });
    return;
  }
  if (totalThreads() === 0 && allOk()) window.close();
}

async function refresh(): Promise<void> {
  refreshButton.disabled = true;
  refreshButton.classList.add("spinning");
  try {
    await send({ type: "refresh" });
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("spinning");
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Links in the email open in a fresh tab (no opener, no referrer); the frame fits its content.
detailFrame.addEventListener("load", () => {
  const doc = detailFrame.contentDocument;
  if (!doc?.body) return;
  doc.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    if (/^(https?|mailto):/i.test(link.href)) void chrome.tabs.create({ url: link.href });
  });
  requestAnimationFrame(() => {
    const height = doc.documentElement.scrollHeight + 2;
    detailFrame.style.height = `${Math.min(Math.max(height, 120), 400)}px`;
  });
});

refreshButton.addEventListener("click", () => void refresh());
$("back").addEventListener("click", showList);
showImagesButton.addEventListener("click", () => renderBody(true));

// The Google window takes focus and closes this popup; the background worker
// finishes sign-in on its own.
addButton.addEventListener("click", () => void send({ type: "add-account" }));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && detail) {
    event.preventDefault();
    showList();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.accounts) return;
  accounts = (changes.accounts.newValue as AccountState[] | undefined) ?? [];
  if (!detail) renderList();
});

if (!GOOGLE_CLIENT_ID) {
  showNotice("No OAuth client ID configured. Set PUBLIC_GOOGLE_CLIENT_ID in .env and rebuild.");
  addButton.disabled = true;
}

const stored = await chrome.storage.local.get("accounts");
accounts = (stored.accounts as AccountState[] | undefined) ?? [];
renderList();

// One unread email: go straight to its preview.
if (totalThreads() === 1 && allOk()) {
  const account = accounts.find((a) => a.threads?.length)!;
  void showDetail(account.email, account.threads![0]!);
}

void refresh();
