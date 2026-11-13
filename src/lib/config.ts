/** Inlined at build time from .env (PUBLIC_GOOGLE_CLIENT_ID). */
export const GOOGLE_CLIENT_ID = process.env.PUBLIC_GOOGLE_CLIENT_ID ?? "";

/**
 * `gmail.modify` lets the extension preview unread mail and mark it read, archive it or report
 * it as spam. It can't delete mail permanently. `openid email` tell your accounts apart.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const SCOPES = ["openid", "email", GMAIL_SCOPE];

/**
 * Label whose unread conversations are counted and previewed.
 * "INBOX" covers every inbox tab; use "CATEGORY_PERSONAL" for Primary only.
 */
export const COUNT_LABEL = "INBOX";

/** How many unread conversations per account the popup previews. */
export const MAX_PREVIEW_THREADS = 25;

/**
 * Backstop alarm that restarts checking if Chrome stops the service worker. Chrome alarms can't
 * fire more often than every 30 seconds; shorter per-account intervals run on a timer.
 */
export const POLL_MINUTES = 0.5;

/** Refresh the access token this long before it actually expires. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
