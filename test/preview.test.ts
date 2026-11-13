import { describe, expect, test } from "bun:test";
import {
  buildPreviewDocument,
  escapeHtml,
  formatDate,
  hasRemoteImages,
} from "../src/lib/preview.ts";

describe("buildPreviewDocument", () => {
  test("blocks remote images by default and allows them on request", () => {
    const blocked = buildPreviewDocument({ html: "<p>Hi</p>" }, false);
    expect(blocked).toContain("default-src 'none'");
    expect(blocked).toContain("script-src 'none'");
    expect(blocked).toContain("form-action 'none'");
    expect(blocked).toContain('img-src data:">');
    expect(blocked).not.toContain("img-src data: https:");
    expect(buildPreviewDocument({ html: "<p>Hi</p>" }, true)).toContain(
      "img-src data: https: http:",
    );
  });

  test("opens links in a new tab", () => {
    expect(buildPreviewDocument({ html: "<a href='https://x.com'>x</a>" }, false)).toContain(
      '<base target="_blank">',
    );
  });

  test("strips meta refresh", () => {
    const doc = buildPreviewDocument(
      { html: '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>Hi</p>' },
      false,
    );
    expect(doc).not.toContain("evil.example");
    expect(doc).toContain("<p>Hi</p>");
  });

  test("falls back to escaped plain text", () => {
    const doc = buildPreviewDocument({ text: "a < b & <script>" }, false);
    expect(doc).toContain("<pre>a &lt; b &amp; &lt;script&gt;</pre>");
  });

  test("handles a message with no text", () => {
    expect(buildPreviewDocument({}, false)).toContain("no text");
  });
});

test("hasRemoteImages", () => {
  expect(hasRemoteImages('<img src="https://t.example/p.gif">')).toBe(true);
  expect(hasRemoteImages("<img src=//t.example/p.gif>")).toBe(true);
  expect(hasRemoteImages('<div style="background:url(https://x/y.png)">')).toBe(true);
  expect(hasRemoteImages('<img src="data:image/png;base64,AAA">')).toBe(false);
  expect(hasRemoteImages(undefined)).toBe(false);
});

test("escapeHtml", () => {
  expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("formatDate shows time today, day and month this year, full date before", () => {
  const now = new Date(2026, 10, 13, 15, 0);
  expect(formatDate(new Date(2026, 10, 13, 9, 5).getTime(), now)).toMatch(/09.05|9.05/);
  expect(formatDate(new Date(2026, 2, 3).getTime(), now)).toMatch(/3/);
  expect(formatDate(new Date(2024, 2, 3).getTime(), now)).toMatch(/2024/);
  expect(formatDate(0, now)).toBe("");
});
