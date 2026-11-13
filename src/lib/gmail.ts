import type { MessageBody, ThreadAction, ThreadSummary } from "./types.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The access token was rejected; get a new one and retry. */
export class AuthError extends Error {
  constructor(message = "Access token rejected") {
    super(message);
    this.name = "AuthError";
  }
}

/** Retrying won't help; the user has to fix something (reconnect, enable the API). */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export const MISSING_GMAIL_ACCESS =
  "Gmail access is missing. Click Reconnect and allow Gmail access (tick its checkbox).";

interface GoogleError {
  error?: { message?: string; status?: string; details?: { reason?: string }[] };
}

export function describeForbidden(body: GoogleError): PermissionError | null {
  const reasons = body.error?.details?.map((d) => d.reason) ?? [];
  const message = body.error?.message ?? "";
  if (
    reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    /insufficient .*scopes/i.test(message)
  ) {
    return new PermissionError(MISSING_GMAIL_ACCESS);
  }
  if (
    reasons.includes("SERVICE_DISABLED") ||
    /has not been used in project|is disabled/i.test(message)
  ) {
    return new PermissionError(
      "The Gmail API is off in your Google Cloud project. Enable it in APIs & Services → Library.",
    );
  }
  return null;
}

async function request(
  url: string,
  token: string,
  fetchFn: Fetch,
  json?: unknown,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: json === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    let detail = res.statusText;
    let body: GoogleError = {};
    try {
      body = (await res.json()) as GoogleError;
      detail = body.error?.message ?? detail;
    } catch {
      // not JSON; keep statusText
    }
    if (res.status === 403) {
      const known = describeForbidden(body);
      if (known) throw known;
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return (await res.json()) as unknown;
}

// ---------------------------------------------------------------------------
// Counts and identity
// ---------------------------------------------------------------------------

/** Unread conversations (threads) in a label, which is what Gmail's own counter shows. */
export async function fetchUnreadCount(
  token: string,
  labelId: string,
  fetchFn: Fetch = fetch,
): Promise<number> {
  const label = (await request(
    `${GMAIL_API}/labels/${encodeURIComponent(labelId)}`,
    token,
    fetchFn,
  )) as { threadsUnread?: unknown };

  if (typeof label.threadsUnread !== "number") {
    throw new Error(`Label ${labelId} has no unread count.`);
  }
  return label.threadsUnread;
}

export async function fetchEmail(token: string, fetchFn: Fetch = fetch): Promise<string> {
  const info = (await request(USERINFO, token, fetchFn)) as { email?: unknown };
  if (typeof info.email !== "string" || !info.email) {
    throw new Error("Google did not return an email address for this token");
  }
  return info.email.toLowerCase();
}

// ---------------------------------------------------------------------------
// Unread conversations
// ---------------------------------------------------------------------------

export interface ListedThread {
  id: string;
  historyId: string;
}

export async function listUnreadThreads(
  token: string,
  labelId: string,
  max: number,
  fetchFn: Fetch = fetch,
): Promise<ListedThread[]> {
  const url = new URL(`${GMAIL_API}/threads`);
  url.searchParams.append("labelIds", labelId);
  url.searchParams.append("labelIds", "UNREAD");
  url.searchParams.set("maxResults", String(max));
  const body = (await request(url.toString(), token, fetchFn)) as {
    threads?: { id: string; historyId: string }[];
  };
  return (body.threads ?? []).map(({ id, historyId }) => ({ id, historyId }));
}

interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailThread {
  id: string;
  historyId: string;
  messages?: GmailMessage[];
}

export function getHeader(part: GmailPart | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

/** `"Ann Lee" <ann@x.com>` → { name: "Ann Lee", email: "ann@x.com" }. */
export function parseFrom(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) {
    const email = value.trim();
    return { name: email, email };
  }
  const email = match[2]!.trim();
  const name = match[1]!
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\(.)/g, "$1")
    .trim();
  return { name: name || email, email };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Gmail snippets come HTML-escaped (`&#39;`, `&amp;` …). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Summarizes a thread by its latest unread message (or its latest message). */
export function summarizeThread(thread: GmailThread): ThreadSummary | null {
  const messages = thread.messages ?? [];
  const target =
    messages.findLast((m) => m.labelIds?.includes("UNREAD")) ?? messages[messages.length - 1];
  if (!target) return null;

  const from = parseFrom(getHeader(target.payload, "From") ?? "");
  return {
    id: thread.id,
    historyId: thread.historyId,
    messageId: target.id,
    fromName: from.name || "(unknown sender)",
    fromEmail: from.email,
    subject: getHeader(target.payload, "Subject")?.trim() || "(no subject)",
    snippet: decodeEntities(target.snippet ?? ""),
    date: Number(target.internalDate ?? 0),
    count: messages.length,
  };
}

export async function fetchThreadSummary(
  token: string,
  threadId: string,
  fetchFn: Fetch = fetch,
): Promise<ThreadSummary | null> {
  const url = new URL(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  return summarizeThread((await request(url.toString(), token, fetchFn)) as GmailThread);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTION_LABELS: Record<ThreadAction, { add: string[]; remove: string[] }> = {
  read: { add: [], remove: ["UNREAD"] },
  archive: { add: [], remove: ["INBOX", "UNREAD"] },
  spam: { add: ["SPAM"], remove: ["INBOX", "UNREAD"] },
};

export async function modifyThread(
  token: string,
  threadId: string,
  action: ThreadAction,
  fetchFn: Fetch = fetch,
): Promise<void> {
  const { add, remove } = ACTION_LABELS[action];
  await request(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`, token, fetchFn, {
    addLabelIds: add,
    removeLabelIds: remove,
  });
}

// ---------------------------------------------------------------------------
// Message body (for the preview)
// ---------------------------------------------------------------------------

export function decodeBase64Url(data: string, charset = "utf-8"): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function charsetOf(part: GmailPart): string {
  const type = getHeader(part, "Content-Type") ?? "";
  return /charset="?([^";\s]+)/i.exec(type)?.[1] ?? "utf-8";
}

/** First text/html and text/plain parts that aren't attachments. */
export function findBodyParts(payload: GmailPart | undefined): {
  html?: GmailPart;
  text?: GmailPart;
} {
  const found: { html?: GmailPart; text?: GmailPart } = {};
  const visit = (part: GmailPart) => {
    if (part.filename) return; // attachment
    if (part.mimeType === "text/html") found.html ??= part;
    else if (part.mimeType === "text/plain") found.text ??= part;
    part.parts?.forEach(visit);
  };
  if (payload) visit(payload);
  return found;
}

export async function fetchMessageBody(
  token: string,
  messageId: string,
  fetchFn: Fetch = fetch,
): Promise<MessageBody> {
  const id = encodeURIComponent(messageId);
  const message = (await request(
    `${GMAIL_API}/messages/${id}?format=full`,
    token,
    fetchFn,
  )) as GmailMessage;
  const parts = findBodyParts(message.payload);

  const read = async (part: GmailPart | undefined): Promise<string | undefined> => {
    if (!part) return undefined;
    let data = part.body?.data;
    if (!data && part.body?.attachmentId) {
      // Large parts are stored like attachments.
      const att = (await request(
        `${GMAIL_API}/messages/${id}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
        token,
        fetchFn,
      )) as { data?: string };
      data = att.data;
    }
    return data ? decodeBase64Url(data, charsetOf(part)) : undefined;
  };

  const [html, text] = await Promise.all([read(parts.html), read(parts.text)]);
  return { ...(html === undefined ? {} : { html }), ...(text === undefined ? {} : { text }) };
}

// ---------------------------------------------------------------------------

export function gmailUrl(email: string, threadId?: string): string {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}`;
  return threadId ? `${base}#inbox/${encodeURIComponent(threadId)}` : base;
}
