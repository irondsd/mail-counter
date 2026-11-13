import type { ListedThread } from "./gmail.ts";
import type { AccountState, ThreadSummary } from "./types.ts";

/** Thread IDs whose summary is new or changed since the last poll. */
export function threadsToFetch(listed: ListedThread[], previous: ThreadSummary[] = []): string[] {
  const known = new Map(previous.map((t) => [t.id, t.historyId]));
  return listed.filter((t) => known.get(t.id) !== t.historyId).map((t) => t.id);
}

/** Summaries in Gmail's order, reusing unchanged ones from the last poll. */
export function mergeThreads(
  listed: ListedThread[],
  previous: ThreadSummary[] = [],
  fetched: ThreadSummary[] = [],
): ThreadSummary[] {
  const byId = new Map<string, ThreadSummary>();
  for (const t of previous) byId.set(t.id, t);
  for (const t of fetched) byId.set(t.id, t);
  return listed.flatMap((l) => {
    const summary = byId.get(l.id);
    return summary && summary.historyId === l.historyId ? [summary] : [];
  });
}

/** Optimistically drops a handled conversation so the popup and badge update at once. */
export function removeThread(
  states: AccountState[],
  email: string,
  threadId: string,
): AccountState[] {
  return states.map((s) => {
    if (s.email !== email || !s.threads?.some((t) => t.id === threadId)) return s;
    return {
      ...s,
      threads: s.threads.filter((t) => t.id !== threadId),
      unread: s.unread === null ? null : Math.max(0, s.unread - 1),
    };
  });
}

/**
 * When everything is fine and nothing is unread, a click on the toolbar icon opens Gmail
 * directly (returns that account). Otherwise the popup shows.
 */
export function inboxToOpenDirectly(states: AccountState[]): string | null {
  if (states.length === 0) return null;
  if (states.some((s) => s.status !== "ok" || (s.unread ?? 0) > 0)) return null;
  return states[0]!.email;
}

/** Timers and alarms drift a little; don't skip a check over a moment's difference. */
const slackMs = (intervalSeconds: number) => Math.min(5_000, intervalSeconds * 200);

/** Whether an account checked at `checkedAt` should be checked again. */
export function isDue(
  checkedAt: number | undefined,
  intervalSeconds: number,
  now: number,
): boolean {
  if (!checkedAt) return true;
  return now - checkedAt >= intervalSeconds * 1000 - slackMs(intervalSeconds);
}

/** Milliseconds until the next account is due (0 if one already is), or null with none. */
export function msUntilNextCheck(
  accounts: { checkedAt?: number; intervalSeconds: number }[],
  now: number,
): number | null {
  if (accounts.length === 0) return null;
  return Math.max(
    0,
    Math.min(
      ...accounts.map(({ checkedAt, intervalSeconds }) =>
        checkedAt ? checkedAt + intervalSeconds * 1000 - now : 0,
      ),
    ),
  );
}

/**
 * True when a check turned up mail that wasn't there before: a new unread conversation, or a
 * newer message in one. Accounts that were just added or were signed out don't count, so
 * connecting an account with a full inbox stays quiet.
 */
export function newMailArrived(previous: AccountState[], next: AccountState[]): boolean {
  return next.some((account) => {
    const before = previous.find((p) => p.email === account.email);
    if (account.status !== "ok" || before?.status !== "ok" || !before.threads) return false;
    const known = new Map(before.threads.map((t) => [t.id, t.date]));
    return (account.threads ?? []).some((t) => {
      const date = known.get(t.id);
      return date === undefined || t.date > date;
    });
  });
}
