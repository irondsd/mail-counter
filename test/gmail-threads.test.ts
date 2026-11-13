import { describe, expect, test } from "bun:test";
import {
  decodeBase64Url,
  decodeEntities,
  fetchMessageBody,
  findBodyParts,
  listUnreadThreads,
  modifyThread,
  parseFrom,
  summarizeThread,
} from "../src/lib/gmail.ts";

type Call = { url: string; init?: RequestInit };

/** Routes requests by URL substring to canned JSON responses. */
function router(routes: Record<string, unknown>, calls: Call[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  };
}

const b64url = (text: string) =>
  Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

test("parseFrom", () => {
  expect(parseFrom('"Lee, Ann" <ann@x.com>')).toEqual({ name: "Lee, Ann", email: "ann@x.com" });
  expect(parseFrom("Bob <bob@x.com>")).toEqual({ name: "Bob", email: "bob@x.com" });
  expect(parseFrom("solo@x.com")).toEqual({ name: "solo@x.com", email: "solo@x.com" });
  expect(parseFrom("<only@x.com>")).toEqual({ name: "only@x.com", email: "only@x.com" });
});

test("decodeEntities", () => {
  expect(decodeEntities("It&#39;s 5 &lt; 6 &amp; &quot;ok&quot; &#x1F600; &nbsp;x")).toBe(
    'It\'s 5 < 6 & "ok" 😀  x',
  );
  expect(decodeEntities("&unknown; &#0;")).toBe("&unknown; &#0;");
});

describe("summarizeThread", () => {
  const message = (id: string, unread: boolean, from: string, subject: string, date: number) => ({
    id,
    labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
    snippet: `snippet ${id} &amp; more`,
    internalDate: String(date),
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "subject", value: subject },
      ],
    },
  });

  test("uses the latest unread message", () => {
    const summary = summarizeThread({
      id: "t1",
      historyId: "9",
      messages: [
        message("m1", true, "Ann <ann@x.com>", "Hello", 1000),
        message("m2", true, "Bob <bob@x.com>", "Re: Hello", 2000),
        message("m3", false, "Me <me@x.com>", "Re: Hello", 3000),
      ],
    });
    expect(summary).toEqual({
      id: "t1",
      historyId: "9",
      messageId: "m2",
      fromName: "Bob",
      fromEmail: "bob@x.com",
      subject: "Re: Hello",
      snippet: "snippet m2 & more",
      date: 2000,
      count: 3,
    });
  });

  test("handles a missing subject and an empty thread", () => {
    const s = summarizeThread({
      id: "t",
      historyId: "1",
      messages: [{ id: "m", payload: { headers: [] } }],
    });
    expect(s?.subject).toBe("(no subject)");
    expect(summarizeThread({ id: "t", historyId: "1" })).toBeNull();
  });
});

test("listUnreadThreads asks for unread Inbox threads", async () => {
  const calls: Call[] = [];
  const threads = await listUnreadThreads(
    "tok",
    "INBOX",
    25,
    router({ "/threads?": { threads: [{ id: "a", historyId: "1", snippet: "x" }] } }, calls),
  );
  expect(threads).toEqual([{ id: "a", historyId: "1" }]);
  const url = new URL(calls[0]!.url);
  expect(url.searchParams.getAll("labelIds")).toEqual(["INBOX", "UNREAD"]);
  expect(url.searchParams.get("maxResults")).toBe("25");
});

test("listUnreadThreads with nothing unread", async () => {
  expect(await listUnreadThreads("tok", "INBOX", 25, router({ "/threads?": {} }))).toEqual([]);
});

describe("modifyThread", () => {
  const cases = [
    ["read", [], ["UNREAD"]],
    ["archive", [], ["INBOX", "UNREAD"]],
    ["spam", ["SPAM"], ["INBOX", "UNREAD"]],
  ] as const;

  for (const [action, add, remove] of cases) {
    test(`${action} changes the right labels`, async () => {
      const calls: Call[] = [];
      await modifyThread("tok", "t1", action, router({ "/threads/t1/modify": {} }, calls));
      expect(calls[0]!.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
        addLabelIds: add,
        removeLabelIds: remove,
      });
    });
  }
});

describe("message body", () => {
  test("decodeBase64Url handles UTF-8 and other charsets", () => {
    expect(decodeBase64Url(b64url("Привет, мир ✓"))).toBe("Привет, мир ✓");
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url");
    expect(decodeBase64Url(latin1, "iso-8859-1")).toBe("café");
  });

  test("findBodyParts skips attachments", () => {
    const parts = findBodyParts({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: "p" } },
            { mimeType: "text/html", body: { data: "h" } },
          ],
        },
        { mimeType: "text/html", filename: "attached.html", body: { attachmentId: "x" } },
      ],
    });
    expect(parts.text?.body?.data).toBe("p");
    expect(parts.html?.body?.data).toBe("h");
  });

  test("fetchMessageBody reads inline parts and large parts stored as attachments", async () => {
    const body = await fetchMessageBody(
      "tok",
      "m1",
      router({
        "/messages/m1/attachments/big": { data: b64url("<p>large html</p>") },
        "/messages/m1?format=full": {
          id: "m1",
          payload: {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
                body: { data: b64url("plain ✓") },
              },
              { mimeType: "text/html", body: { attachmentId: "big", size: 99999 } },
            ],
          },
        },
      }),
    );
    expect(body).toEqual({ text: "plain ✓", html: "<p>large html</p>" });
  });
});
