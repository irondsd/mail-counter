import { playChime } from "../lib/chime.ts";
import { GOOGLE_CLIENT_ID } from "../lib/config.ts";
import { formatDate } from "../lib/preview.ts";
import {
  type EmptyClick,
  formatInterval,
  INTERVAL_CHOICES,
  intervalFor,
  normalizeSettings,
  type Settings,
  type Theme,
} from "../lib/settings.ts";
import { applyTheme, initTheme } from "../lib/theme.ts";
import type { AccountState, Message, Reply } from "../lib/types.ts";

initTheme();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const notice = $("notice");
const list = $("accounts");
const noAccounts = $("no-accounts");
const addButton = $<HTMLButtonElement>("add");
const accountTpl = $<HTMLTemplateElement>("account-tpl");
const soundBox = $<HTMLInputElement>("sound");
const volume = $<HTMLInputElement>("volume");
const volumeRow = volume.parentElement!;
const themeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="theme"]')];
const emptyClick = [...document.querySelectorAll<HTMLInputElement>('input[name="empty-click"]')];

let emails: string[] = [];
let states: AccountState[] = [];
let settings: Settings = normalizeSettings(undefined);

function showNotice(text: string | null): void {
  notice.hidden = !text;
  notice.textContent = text ?? "";
}

async function send(message: Message): Promise<Reply> {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply | undefined;
  if (!reply) return { ok: false, error: "No answer from the extension" };
  showNotice(reply.ok ? null : reply.error);
  return reply;
}

async function saveSettings(change: (s: Settings) => void): Promise<void> {
  // Re-read first so two open options tabs don't overwrite each other.
  const { settings: raw } = await chrome.storage.sync.get("settings");
  settings = normalizeSettings(raw);
  change(settings);
  await chrome.storage.sync.set({ settings });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function describe(state: AccountState | undefined): { text: string; tone: string } {
  if (!state) return { text: "Connecting…", tone: "" };
  const when = state.checkedAt ? ` · checked ${formatDate(state.checkedAt)}` : "";
  if (state.status === "ok") {
    const unread = state.unread ?? 0;
    return { text: `Connected · ${unread} unread${when}`, tone: "ok" };
  }
  if (state.status === "needs-auth") {
    return { text: state.error ?? "Needs you to sign in again", tone: "problem" };
  }
  return { text: `${state.error ?? "Error"}${when}`, tone: "problem" };
}

function renderAccount(email: string): HTMLLIElement {
  const row = accountTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  const state = states.find((s) => s.email === email);
  const status = row.querySelector<HTMLElement>(".status")!;
  const select = row.querySelector("select")!;
  const reconnect = row.querySelector<HTMLButtonElement>(".reconnect")!;

  row.querySelector(".email")!.textContent = email;
  const { text, tone } = describe(state);
  status.textContent = text;
  if (tone) status.classList.add(tone);

  const current = intervalFor(settings, email);
  const choices: number[] = INTERVAL_CHOICES.includes(current as never)
    ? [...INTERVAL_CHOICES]
    : [...INTERVAL_CHOICES, current].sort((a, b) => a - b);
  select.append(
    ...choices.map((m) => new Option(formatInterval(m), String(m), false, m === current)),
  );
  select.setAttribute("aria-label", `Check ${email} every`);
  select.addEventListener("change", () => {
    const seconds = Number(select.value);
    void saveSettings((s) => {
      s.checkEvery[email] = seconds;
    });
  });

  reconnect.hidden = state?.status !== "needs-auth";
  reconnect.addEventListener("click", () => void send({ type: "reconnect", email }));

  row.querySelector(".remove")!.addEventListener("click", () => {
    if (confirm(`Stop checking ${email}? You can add it again later.`)) {
      void send({ type: "remove", email });
    }
  });
  return row;
}

function renderAccounts(): void {
  list.replaceChildren(...emails.map(renderAccount));
  noAccounts.hidden = emails.length > 0;
}

// ---------------------------------------------------------------------------
// Toolbar icon
// ---------------------------------------------------------------------------

function renderEmptyClick(): void {
  for (const radio of emptyClick) radio.checked = radio.value === settings.emptyClick;
}

for (const radio of emptyClick) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    void saveSettings((s) => {
      s.emptyClick = radio.value as EmptyClick;
    });
  });
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function renderTheme(): void {
  for (const radio of themeRadios) radio.checked = radio.value === settings.theme;
}

for (const radio of themeRadios) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    const theme = radio.value as Theme;
    applyTheme(theme); // right away, without waiting for the sync round trip
    void saveSettings((s) => {
      s.theme = theme;
    });
  });
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

function renderSound(): void {
  soundBox.checked = settings.sound;
  volume.value = String(Math.round(settings.volume * 100));
  volumeRow.classList.toggle("off", !settings.sound);
}

soundBox.addEventListener("change", () => {
  volumeRow.classList.toggle("off", !soundBox.checked);
  void saveSettings((s) => {
    s.sound = soundBox.checked;
  });
});

volume.addEventListener("change", () => {
  const value = Number(volume.value) / 100;
  void saveSettings((s) => {
    s.volume = value;
  });
  void playChime(value);
});

$("test-sound").addEventListener("click", () => void playChime(Number(volume.value) / 100));

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// The Google sign-in window opens on top; the list updates when it's done.
addButton.addEventListener("click", () => void send({ type: "add-account" }));

if (!GOOGLE_CLIENT_ID) {
  showNotice("No OAuth client ID configured. Set PUBLIC_GOOGLE_CLIENT_ID in .env and rebuild.");
  addButton.disabled = true;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.emails) emails = (changes.emails.newValue as string[]) ?? [];
  if (area === "sync" && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    renderSound();
    renderEmptyClick();
    renderTheme();
  }
  if (area === "local" && changes.accounts) {
    states = (changes.accounts.newValue as AccountState[] | undefined) ?? [];
  }
  if (changes.emails || changes.settings || changes.accounts) renderAccounts();
});

const [sync, local] = await Promise.all([
  chrome.storage.sync.get(["emails", "settings"]),
  chrome.storage.local.get("accounts"),
]);
emails = Array.isArray(sync.emails) ? (sync.emails as string[]) : [];
settings = normalizeSettings(sync.settings);
states = (local.accounts as AccountState[] | undefined) ?? [];
renderAccounts();
renderSound();
renderEmptyClick();
renderTheme();
