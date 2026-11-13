import { describe, expect, test } from "bun:test";
import { AuthError, fetchEmail, fetchUnreadCount, gmailUrl } from "../src/lib/gmail.ts";

function fakeFetch(
  status: number,
  body: unknown,
  calls: { url: string; init?: RequestInit }[] = [],
) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("fetchUnreadCount", () => {
  test("returns threadsUnread for the label and sends the token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const n = await fetchUnreadCount(
      "tok",
      "INBOX",
      fakeFetch(200, { id: "INBOX", messagesUnread: 9, threadsUnread: 4 }, calls),
    );
    expect(n).toBe(4);
    expect(calls[0]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
  });

  test("zero unread is a valid count", async () => {
    expect(await fetchUnreadCount("tok", "INBOX", fakeFetch(200, { threadsUnread: 0 }))).toBe(0);
  });

  test("401 means the token needs replacing", async () => {
    await expect(fetchUnreadCount("tok", "INBOX", fakeFetch(401, {}))).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  test("other errors carry Google's message", async () => {
    const f = fakeFetch(403, {
      error: { message: "Request had insufficient authentication scopes." },
    });
    await expect(fetchUnreadCount("tok", "INBOX", f)).rejects.toThrow(
      "HTTP 403: Request had insufficient authentication scopes.",
    );
  });

  test("missing counts are an error, not zero", async () => {
    await expect(fetchUnreadCount("tok", "INBOX", fakeFetch(200, { id: "INBOX" }))).rejects.toThrow(
      "no unread count",
    );
  });
});

describe("fetchEmail", () => {
  test("returns the lower-cased email", async () => {
    expect(await fetchEmail("tok", fakeFetch(200, { email: "Me@Gmail.com" }))).toBe("me@gmail.com");
  });

  test("throws without an email", async () => {
    await expect(fetchEmail("tok", fakeFetch(200, { sub: "1" }))).rejects.toThrow("email");
  });
});

test("gmailUrl opens the right account", () => {
  expect(gmailUrl("a+b@gmail.com")).toBe(
    "https://mail.google.com/mail/?authuser=a%2Bb%40gmail.com",
  );
});
