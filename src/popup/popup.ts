import { formatCount } from "../lib/badge.ts";
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

const accountsEl = $("accounts");
const empty = $("empty");
const notice = $("notice");
const checked = $("checked");
const refreshButton = $<HTMLButtonElement>("refresh");
const accountTpl = $<HTMLTemplateElement>("account-tpl");
const threadTpl = $<HTMLTemplateElement>("thread-tpl");

const FRAME_MIN = 120;

let accounts: AccountState[] = [];

/** The card showing its whole email. Its body is kept here so re-renders don't refetch it. */
let expanded: {
  email: string;
  threadId: string;
  body?: MessageBody;
  error?: string;
  images: boolean;
} | null = null;

const ACTIONS: { action: ThreadAction | "open"; icon: string; label: string }[] = [
  { action: "read", icon: "i-read", label: "Mark as read" },
  { action: "archive", icon: "i-archive", label: "Archive" },
  { action: "spam", icon: "i-spam", label: "Report spam" },
  { action: "open", icon: "i-open", label: "Open in Gmail" },
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

function openOptions(): void {
  void chrome.runtime.openOptionsPage();
  window.close();
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
const isExpanded = (email: string, thread: ThreadSummary) =>
  expanded?.email === email && expanded.threadId === thread.id;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Fills an open card's body area from `expanded`. */
function renderBody(li: HTMLElement): void {
  if (!expanded) return;
  const status = el<HTMLElement>(li, ".body-status");
  const frame = el<HTMLIFrameElement>(li, ".body-frame");
  const showImages = el<HTMLButtonElement>(li, ".show-images");
  el<HTMLElement>(li, ".thread-body").hidden = false;

  if (!expanded.body) {
    status.textContent = expanded.error ?? "Loading…";
    status.hidden = false;
    frame.hidden = true;
    showImages.hidden = true;
    return;
  }
  status.hidden = true;
  showImages.hidden = expanded.images || !hasRemoteImages(expanded.body.html);
  frame.srcdoc = buildPreviewDocument(expanded.body, expanded.images);
  frame.hidden = false;
}

function renderThread(email: string, thread: ThreadSummary): HTMLLIElement {
  const li = threadTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  const main = el<HTMLButtonElement>(li, ".thread-main");
  const from = el<HTMLElement>(li, ".from");
  from.textContent = thread.count > 1 ? `${thread.fromName} (${thread.count})` : thread.fromName;
  from.title = thread.fromEmail;
  el(li, ".date").textContent = formatDate(thread.date);
  el(li, ".subject").textContent = thread.subject;
  el(li, ".snippet").textContent = thread.snippet;
  el(li, ".actions").append(...actionButtons(email, thread));
  main.addEventListener("click", () => toggle(email, thread));

  el(li, ".show-images").addEventListener("click", () => {
    if (!expanded) return;
    expanded.images = true;
    renderBody(li);
  });

  const frame = el<HTMLIFrameElement>(li, ".body-frame");
  frame.addEventListener("load", () => fitFrame(frame));

  if (isExpanded(email, thread)) {
    li.classList.add("expanded");
    main.setAttribute("aria-expanded", "true");
    renderBody(li);
  }
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

function render(): void {
  // An open card whose conversation is gone (read elsewhere, archived…) closes.
  if (
    expanded &&
    !accounts.some(
      (a) => a.email === expanded!.email && a.threads?.some((t) => t.id === expanded!.threadId),
    )
  ) {
    expanded = null;
  }
  const scroll = accountsEl.scrollTop;
  accountsEl.replaceChildren(...accounts.map(renderAccount));
  accountsEl.scrollTop = scroll;
  empty.hidden = accounts.length > 0;
  const last = Math.max(0, ...accounts.map((a) => a.checkedAt ?? 0));
  checked.textContent = last ? `Checked ${formatDate(last)}` : "";
}

/**
 * The email frame grows to fit its content, up to what fits in the popup below the card's
 * header; longer emails scroll inside it. The card scrolls to the top so the sender, subject
 * and buttons stay in view.
 */
function fitFrame(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc?.body || !frame.srcdoc) return;
  // Links in the email open in a fresh tab (no opener, no referrer).
  doc.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    if (/^(https?|mailto):/i.test(link.href)) void chrome.tabs.create({ url: link.href });
  });
  requestAnimationFrame(() => {
    const card = frame.closest<HTMLElement>(".thread");
    const head = card?.closest(".account")?.querySelector<HTMLElement>(".account-head");
    if (!card) return;
    const above = frame.getBoundingClientRect().top - card.getBoundingClientRect().top;
    const room = accountsEl.clientHeight - (head?.offsetHeight ?? 0) - above - 14;
    const height = doc.documentElement.scrollHeight + 2;
    frame.style.height = `${Math.max(FRAME_MIN, Math.min(height, room))}px`;
    accountsEl.scrollTop +=
      card.getBoundingClientRect().top -
      accountsEl.getBoundingClientRect().top -
      (head?.offsetHeight ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Expanding a card
// ---------------------------------------------------------------------------

function toggle(email: string, thread: ThreadSummary): void {
  if (isExpanded(email, thread)) {
    collapse();
    return;
  }
  expanded = { email, threadId: thread.id, images: false };
  render();
  void loadBody(email, thread);
}

function collapse(): void {
  expanded = null;
  render();
}

async function loadBody(email: string, thread: ThreadSummary): Promise<void> {
  const reply = await send<MessageBody>(
    { type: "get-body", email, messageId: thread.messageId },
    true, // the error shows in place of the body
  );
  if (!isExpanded(email, thread)) return; // closed or opened another meanwhile
  if (reply.ok && reply.data) expanded!.body = reply.data;
  else expanded!.error = reply.ok ? "Couldn't load this email." : reply.error;
  render();
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
  if (isExpanded(email, thread)) expanded = null;
  render();

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

refreshButton.addEventListener("click", () => void refresh());
$("options").addEventListener("click", openOptions);
$("open-options").addEventListener("click", openOptions);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && expanded) {
    event.preventDefault();
    collapse();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.accounts) return;
  accounts = (changes.accounts.newValue as AccountState[] | undefined) ?? [];
  if (!expanded) {
    render();
    return;
  }
  // Keep the open email steady; closing it renders the update. Re-render now only if its
  // conversation went away.
  const stillThere = accounts.some(
    (a) => a.email === expanded!.email && a.threads?.some((t) => t.id === expanded!.threadId),
  );
  if (!stillThere) render();
});

const stored = await chrome.storage.local.get("accounts");
accounts = (stored.accounts as AccountState[] | undefined) ?? [];
render();

// One unread email: open it straight away.
if (totalThreads() === 1 && allOk()) {
  const account = accounts.find((a) => a.threads?.length)!;
  toggle(account.email, account.threads![0]!);
}

void refresh();
