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
