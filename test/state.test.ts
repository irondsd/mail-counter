import { describe, expect, test } from "bun:test";
import {
  inboxToOpenDirectly,
  isDue,
  mergeThreads,
  msUntilNextCheck,
  newMailArrived,
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

describe("isDue", () => {
  const t = 1_000_000;
  test("never checked → due", () => expect(isDue(undefined, 60, t)).toBe(true));
  test("waits for the interval", () => {
    expect(isDue(t, 300, t + 240_000)).toBe(false);
    expect(isDue(t, 300, t + 300_000)).toBe(true);
  });
  test("a wake-up a moment early still counts", () => {
    expect(isDue(t, 60, t + 57_000)).toBe(true);
    expect(isDue(t, 10, t + 8_500)).toBe(true);
    expect(isDue(t, 10, t + 5_000)).toBe(false);
  });
});

describe("msUntilNextCheck", () => {
  const t = 1_000_000;
  test("waits for whichever account is due first", () => {
    const accounts = [
      { checkedAt: t, intervalSeconds: 60 },
      { checkedAt: t - 5_000, intervalSeconds: 10 },
    ];
    expect(msUntilNextCheck(accounts, t)).toBe(5_000);
  });
  test("overdue or never checked → now", () => {
    expect(msUntilNextCheck([{ checkedAt: t - 99_000, intervalSeconds: 10 }], t)).toBe(0);
    expect(msUntilNextCheck([{ intervalSeconds: 10 }], t)).toBe(0);
  });
  test("no accounts → nothing to schedule", () => {
    expect(msUntilNextCheck([], t)).toBeNull();
  });
});

describe("newMailArrived", () => {
  const at = (id: string, date: number) => ({ ...summary(id, "1"), date });
  const ok = (threads: ThreadSummary[]): AccountState => ({
    email: "a@x.com",
    status: "ok",
    unread: threads.length,
    threads,
  });

  test("a new unread conversation", () => {
    expect(newMailArrived([ok([at("a", 1)])], [ok([at("b", 2), at("a", 1)])])).toBe(true);
  });

  test("a new message in an unread conversation", () => {
    expect(newMailArrived([ok([at("a", 1)])], [ok([at("a", 5)])])).toBe(true);
  });

  test("nothing new, or mail was read", () => {
    expect(newMailArrived([ok([at("a", 1)])], [ok([at("a", 1)])])).toBe(false);
    expect(newMailArrived([ok([at("a", 1), at("b", 1)])], [ok([at("a", 1)])])).toBe(false);
  });

  test("a just-added or just-reconnected account is quiet", () => {
    expect(newMailArrived([], [ok([at("a", 1)])])).toBe(false);
    const signedOut: AccountState = { email: "a@x.com", status: "needs-auth", unread: null };
    expect(newMailArrived([signedOut], [ok([at("a", 1)])])).toBe(false);
  });

  test("an empty inbox getting its first email chimes", () => {
    expect(newMailArrived([ok([])], [ok([at("a", 1)])])).toBe(true);
  });
});
