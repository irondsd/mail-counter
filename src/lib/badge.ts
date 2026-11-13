import type { AccountState } from "./types.ts";

export const BADGE_COLOR = "#d93025";
export const BADGE_WARNING_COLOR = "#e37400";

export interface Badge {
  text: string;
  color: string;
  title: string;
}

export function formatCount(n: number): string {
  return n > 999 ? "999+" : String(n);
}

export function computeBadge(accounts: AccountState[]): Badge {
  if (accounts.length === 0) {
    return {
      text: "",
      color: BADGE_COLOR,
      title: "Mail Counter: click to add a Gmail account",
    };
  }

  const total = accounts.reduce((sum, a) => sum + (a.unread ?? 0), 0);
  const hasProblem = accounts.some((a) => a.status !== "ok");

  let text = total > 0 ? formatCount(total) : "";
  if (hasProblem && total === 0) text = "!";

  const lines = accounts.map((a) => {
    if (a.status === "needs-auth") return `${a.email}: sign-in needed`;
    if (a.status === "error") return `${a.email}: ${a.error ?? "error"}`;
    return `${a.email}: ${a.unread ?? 0} unread`;
  });

  return {
    text,
    color: hasProblem ? BADGE_WARNING_COLOR : BADGE_COLOR,
    title: ["Mail Counter", ...lines].join("\n"),
  };
}
