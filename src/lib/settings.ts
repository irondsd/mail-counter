/** User preferences, edited on the options page. Stored in chrome.storage.sync. */
export interface Settings {
  /** Play a chime when new mail arrives. */
  sound: boolean;
  /** Chime volume, 0–1. */
  volume: number;
  /** Seconds between checks, per account. Missing → DEFAULT_INTERVAL_SECONDS. */
  checkEvery: Record<string, number>;
  /** What clicking the toolbar icon does when nothing is unread. */
  emptyClick: EmptyClick;
  /** Color theme of the popup and options page. */
  theme: Theme;
}

/** "gmail" opens the inbox in a tab; "popup" shows the popup as usual. */
export type EmptyClick = "gmail" | "popup";

/** "system" follows the browser's light or dark setting. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

export const MIN_INTERVAL_SECONDS = 10;
export const MAX_INTERVAL_SECONDS = 10 * 60;
export const DEFAULT_INTERVAL_SECONDS = 60;

/** Choices offered on the options page. */
export const INTERVAL_CHOICES = [10, 15, 30, 60, 120, 300, 600] as const;

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.6,
  checkEvery: {},
  emptyClick: "gmail",
  theme: "system",
};

const clampInterval = (seconds: number) =>
  Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)));

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Fills in defaults and drops anything malformed (storage may hold older or synced data). */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const checkEvery: Record<string, number> = {};
  // Earlier versions stored whole minutes under `intervals`.
  if (r.intervals && typeof r.intervals === "object") {
    for (const [email, minutes] of Object.entries(r.intervals)) {
      if (isNumber(minutes) && minutes > 0) checkEvery[email] = clampInterval(minutes * 60);
    }
  }
  if (r.checkEvery && typeof r.checkEvery === "object") {
    for (const [email, seconds] of Object.entries(r.checkEvery)) {
      if (isNumber(seconds) && seconds > 0) checkEvery[email] = clampInterval(seconds);
    }
  }
  return {
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_SETTINGS.sound,
    volume: isNumber(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_SETTINGS.volume,
    checkEvery,
    emptyClick: r.emptyClick === "popup" ? "popup" : DEFAULT_SETTINGS.emptyClick,
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_SETTINGS.theme,
  };
}

/** Seconds between checks for `email`. */
export function intervalFor(settings: Settings, email: string): number {
  return settings.checkEvery[email] ?? DEFAULT_INTERVAL_SECONDS;
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
