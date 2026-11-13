export type AccountStatus = "ok" | "needs-auth" | "error";

export interface Token {
  accessToken: string;
  expiresAt: number;
  /** Scopes Google actually granted; the user can untick some on the consent screen. */
  scopes?: string[];
}

/** One unread conversation, as previewed in the popup. */
export interface ThreadSummary {
  id: string;
  /** Changes whenever anything in the conversation changes; used to skip refetching. */
  historyId: string;
  /** Latest unread message; its body is fetched only when you open the preview. */
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number;
  /** Messages in the conversation. */
  count: number;
}

/** What the popup and badge render. Stored in chrome.storage.local. */
export interface AccountState {
  email: string;
  status: AccountStatus;
  unread: number | null;
  threads?: ThreadSummary[];
  error?: string;
  checkedAt?: number;
}

export type ThreadAction = "read" | "archive" | "spam";

export interface MessageBody {
  html?: string;
  text?: string;
}

export type Message =
  | { type: "add-account" }
  | { type: "reconnect"; email: string }
  | { type: "remove"; email: string }
  | { type: "refresh" }
  | { type: "open"; email: string }
  | { type: "open-thread"; email: string; threadId: string }
  | { type: "thread-action"; email: string; threadId: string; action: ThreadAction }
  | { type: "get-body"; email: string; messageId: string };

export type Reply<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Background → offscreen document. */
export interface OffscreenMessage {
  target: "offscreen";
  type: "chime";
  volume: number;
}
