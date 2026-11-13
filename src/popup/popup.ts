import { formatCount } from "../lib/badge.ts";
import { GOOGLE_CLIENT_ID } from "../lib/config.ts";
import type { AccountState, Message, Reply } from "../lib/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const list = $<HTMLUListElement>("accounts");
const empty = $("empty");
const notice = $("notice");
const checked = $("checked");
const refreshButton = $<HTMLButtonElement>("refresh");
const addButton = $<HTMLButtonElement>("add");
const rowTemplate = $<HTMLTemplateElement>("row");

function showNotice(text: string | null): void {
  notice.hidden = !text;
  notice.textContent = text ?? "";
}

async function send(message: Message): Promise<void> {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply | undefined;
  if (reply && !reply.ok) showNotice(reply.error);
}

function render(accounts: AccountState[]): void {
  list.replaceChildren(
    ...accounts.map((account) => {
      const row = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
      const open = row.querySelector<HTMLButtonElement>(".open")!;
      const count = row.querySelector<HTMLSpanElement>(".count")!;
      const reconnect = row.querySelector<HTMLButtonElement>(".reconnect")!;
      const remove = row.querySelector<HTMLButtonElement>(".remove")!;

      row.querySelector(".email")!.textContent = account.email;
      open.title = `Open Gmail for ${account.email}`;

      if (account.status === "needs-auth") {
        count.textContent = "signed out";
        count.className = "count problem";
        reconnect.hidden = false;
      } else if (account.status === "error") {
        count.textContent = account.unread === null ? "error" : `${formatCount(account.unread)} ⚠`;
        count.className = "count problem";
        count.title = account.error ?? "";
      } else {
        const n = account.unread ?? 0;
        count.textContent = formatCount(n);
        count.className = n > 0 ? "count has-unread" : "count";
      }

      open.addEventListener("click", () => {
        void send({ type: "open", email: account.email }).then(() => window.close());
      });
      reconnect.addEventListener("click", () => {
        void send({ type: "reconnect", email: account.email });
      });
      remove.addEventListener("click", () => {
        if (confirm(`Stop watching ${account.email}?`)) {
          void send({ type: "remove", email: account.email });
        }
      });
      return row;
    }),
  );

  empty.hidden = accounts.length > 0;

  const last = Math.max(0, ...accounts.map((a) => a.checkedAt ?? 0));
  checked.textContent = last
    ? `Checked ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
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

refreshButton.addEventListener("click", () => void refresh());

// The Google window takes focus and closes this popup; the background worker
// finishes sign-in on its own.
addButton.addEventListener("click", () => void send({ type: "add-account" }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.accounts) {
    render((changes.accounts.newValue as AccountState[] | undefined) ?? []);
  }
});

if (!GOOGLE_CLIENT_ID) {
  showNotice("No OAuth client ID configured. Set PUBLIC_GOOGLE_CLIENT_ID in .env and rebuild.");
  addButton.disabled = true;
}

const { accounts } = await chrome.storage.local.get("accounts");
render((accounts as AccountState[] | undefined) ?? []);
void refresh();
