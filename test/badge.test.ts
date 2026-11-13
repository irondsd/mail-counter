import { describe, expect, test } from "bun:test";
import { BADGE_COLOR, BADGE_WARNING_COLOR, computeBadge, formatCount } from "../src/lib/badge.ts";
import type { AccountState } from "../src/lib/types.ts";

const ok = (email: string, unread: number): AccountState => ({ email, status: "ok", unread });

describe("computeBadge", () => {
  test("no accounts: empty badge with a hint", () => {
    const badge = computeBadge([]);
    expect(badge.text).toBe("");
    expect(badge.title).toContain("add a Gmail account");
  });

  test("sums unread across accounts", () => {
    const badge = computeBadge([ok("a@gmail.com", 3), ok("b@gmail.com", 2)]);
    expect(badge).toEqual({
      text: "5",
      color: BADGE_COLOR,
      title: "Mail Counter\na@gmail.com: 3 unread\nb@gmail.com: 2 unread",
    });
  });

  test("nothing unread: empty badge", () => {
    expect(computeBadge([ok("a@gmail.com", 0)]).text).toBe("");
  });

  test("a signed-out account turns the badge amber and keeps the other count", () => {
    const badge = computeBadge([
      ok("a@gmail.com", 3),
      { email: "b@gmail.com", status: "needs-auth", unread: null },
    ]);
    expect(badge.text).toBe("3");
    expect(badge.color).toBe(BADGE_WARNING_COLOR);
    expect(badge.title).toContain("b@gmail.com: sign-in needed");
  });

  test("a problem with nothing unread shows '!'", () => {
    const badge = computeBadge([
      { email: "a@gmail.com", status: "error", unread: null, error: "offline" },
    ]);
    expect(badge.text).toBe("!");
    expect(badge.title).toContain("a@gmail.com: offline");
  });
});

test("formatCount fits the badge", () => {
  expect(formatCount(7)).toBe("7");
  expect(formatCount(999)).toBe("999");
  expect(formatCount(1000)).toBe("999+");
});
