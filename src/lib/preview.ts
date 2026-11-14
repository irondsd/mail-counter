import type { MessageBody } from "./types.ts";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Remote images (often tracking pixels) are blocked until you click "Show images". */
export function hasRemoteImages(html: string | undefined): boolean {
  if (!html) return false;
  return (
    /<img\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /url\(\s*["']?https?:/i.test(html)
  );
}

/**
 * The document shown in the preview iframe. Chrome won't load sandboxed iframes inside
 * extension pages, so this CSP does the locking down: no scripts, no forms, no network
 * requests except (on request) images. The extension's own CSP blocks scripts too.
 */
export function buildPreviewDocument(body: MessageBody, allowRemoteImages: boolean): string {
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "form-action 'none'",
    "style-src 'unsafe-inline'",
    "font-src data:",
    `img-src data:${allowRemoteImages ? " https: http:" : ""}`,
  ].join("; ");

  const head = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<base target="_blank">',
    "<style>",
    "html{background:#fff;color:#202124;font:14px/1.5 system-ui,-apple-system,sans-serif}",
    "body{margin:12px 14px;overflow-wrap:anywhere}",
    "img{max-width:100%;height:auto}",
    "pre{margin:0;white-space:pre-wrap;font:inherit}",
    "</style>",
  ].join("");

  let content: string;
  if (body.html !== undefined) {
    // A refresh tag could navigate the frame away; nothing else in the email can run.
    content = body.html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  } else if (body.text !== undefined) {
    content = `<pre>${escapeHtml(body.text)}</pre>`;
  } else {
    content = "<p><i>This message has no text.</i></p>";
  }
  return `<!doctype html><html><head>${head}</head><body>${content}</body></html>`;
}

/** The first letter or digit of a name or address, upper-cased, for an avatar. */
export function initial(text: string): string {
  const match = /[\p{L}\p{N}]/u.exec(text);
  return match ? match[0].toLocaleUpperCase() : "?";
}

/** "14:05" today, "13 Nov" this year, "13/11/2025" before that. */
export function formatDate(ms: number, now: Date = new Date()): string {
  if (!ms) return "";
  const date = new Date(ms);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString();
}
