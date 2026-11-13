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

async function getJson(url: string, token: string, fetchFn: Fetch) {
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // not JSON; keep statusText
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return (await res.json()) as unknown;
}

/** Unread conversations (threads) in a label, which is what Gmail's own counter shows. */
export async function fetchUnreadCount(
  token: string,
  labelId: string,
  fetchFn: Fetch = fetch,
): Promise<number> {
  const label = (await getJson(
    `${GMAIL_API}/labels/${encodeURIComponent(labelId)}`,
    token,
    fetchFn,
  )) as { threadsUnread?: unknown };

  if (typeof label.threadsUnread !== "number") {
    throw new Error(`Label ${labelId} has no unread count. The token's scope may be too narrow.`);
  }
  return label.threadsUnread;
}

export async function fetchEmail(token: string, fetchFn: Fetch = fetch): Promise<string> {
  const info = (await getJson(USERINFO, token, fetchFn)) as {
    email?: unknown;
  };
  if (typeof info.email !== "string" || !info.email) {
    throw new Error("Google did not return an email address for this token");
  }
  return info.email.toLowerCase();
}

export function gmailUrl(email: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}`;
}
