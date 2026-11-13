/** Inlined at build time from .env (PUBLIC_GOOGLE_CLIENT_ID). */
export const GOOGLE_CLIENT_ID = process.env.PUBLIC_GOOGLE_CLIENT_ID ?? "";

/**
 * `gmail.labels` is enough to read label unread counts and is lighter than
 * `gmail.readonly` / `gmail.metadata`. `openid email` lets us learn which
 * account a token belongs to.
 */
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.labels"];

/**
 * Label whose unread conversations are counted.
 * "INBOX" counts every inbox tab; use "CATEGORY_PERSONAL" for Primary only.
 */
export const COUNT_LABEL = "INBOX";

/** Polling interval. Chrome alarms can't fire more often than every 30s. */
export const POLL_MINUTES = 1;

/** Refresh the access token this long before it actually expires. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
