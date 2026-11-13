export type AccountStatus = "ok" | "needs-auth" | "error";

export interface Token {
  accessToken: string;
  expiresAt: number;
}

/** What the popup and badge render. Stored in chrome.storage.local. */
export interface AccountState {
  email: string;
  status: AccountStatus;
  unread: number | null;
  error?: string;
  checkedAt?: number;
}

export type Message =
  | { type: "add-account" }
  | { type: "reconnect"; email: string }
  | { type: "remove"; email: string }
  | { type: "refresh" }
  | { type: "open"; email: string };

export type Reply = { ok: true } | { ok: false; error: string };
