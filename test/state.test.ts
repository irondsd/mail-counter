import { describe, expect, test } from "bun:test";
import {
  inboxToOpenDirectly,
  mergeThreads,
  removeThread,
  threadsToFetch,
} from "../src/lib/state.ts";
import type { AccountState, ThreadSummary } from "../src/lib/types.ts";

const summary = (id: string, historyId: string): ThreadSummary => ({
  id,
  historyId,
  messageId: `m-${id}`,
  fromName: "Ann",
  fromEmail: "ann@example.com",
  subject: `Subject ${id}`,
  snippet: "",
  date: 0,
  count: 1,
});

describe("thread caching", () => {
  const previous = [summary("a", "1"), summary("b", "1")];

  test("only new or changed threads are fetched", () => {
    const listed = [
      { id: "c", historyId: "5" },
      { id: "a", historyId: "1" },
      { id: "b", historyId: "2" },
    ];
    expect(threadsToFetch(listed, previous)).toEqual(["c", "b"]);
    expect(threadsToFetch(listed)).toEqual(["c", "a", "b"]);
  });

  test("merge keeps Gmail's order and drops threads that are no longer unread", () => {
    const listed = [
      { id: "c", historyId: "5" },
      { id: "a", historyId: "1" },
    ];
    const merged = mergeThreads(listed, previous, [summary("c", "5")]);
    expect(merged.map((t) => t.id)).toEqual(["c", "a"]);
  });

  test("a changed thread whose refetch failed is left out rather than shown stale", () => {
    const merged = mergeThreads([{ id: "b", historyId: "2" }], previous, []);
    expect(merged).toEqual([]);
  });
});

describe("removeThread", () => {
  const states: AccountState[] = [
    {
      email: "a@x.com",
      status: "ok",
      unread: 2,
      threads: [summary("t1", "1"), summary("t2", "1")],
    },
    { email: "b@x.com", status: "ok", unread: 1, threads: [summary("t1", "1")] },
  ];

  test("drops the thread from that account only and lowers its count", () => {
    const next = removeThread(states, "a@x.com", "t1");
    expect(next[0]!.unread).toBe(1);
    expect(next[0]!.threads!.map((t) => t.id)).toEqual(["t2"]);
    expect(next[1]).toBe(states[1]!);
  });

  test("unknown thread changes nothing", () => {
    expect(removeThread(states, "a@x.com", "nope")).toEqual(states);
  });
});

describe("inboxToOpenDirectly", () => {
  const ok = (email: string, unread: number): AccountState => ({ email, status: "ok", unread });

  test("nothing unread anywhere: open the first account", () => {
    expect(inboxToOpenDirectly([ok("a@x.com", 0), ok("b@x.com", 0)])).toBe("a@x.com");
  });

  test("unread mail shows the popup", () => {
    expect(inboxToOpenDirectly([ok("a@x.com", 0), ok("b@x.com", 2)])).toBeNull();
  });

  test("a problem shows the popup so you can fix it", () => {
    expect(
      inboxToOpenDirectly([
        ok("a@x.com", 0),
        { email: "b@x.com", status: "needs-auth", unread: null },
      ]),
    ).toBeNull();
  });

  test("no accounts shows the popup so you can add one", () => {
    expect(inboxToOpenDirectly([])).toBeNull();
  });
});
