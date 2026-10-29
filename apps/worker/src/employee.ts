import type { SupabaseClient } from "@supabase/supabase-js";
import type { Counterparty, Database, IdentityFile } from "@ate/shared";

export interface LoadedEmployee {
  id: string;
  org_id: string;
  name: string;
  identity: IdentityFile;
}

/** Load the employee's row (identity file + org) for a turn (docs/architecture.md "The flow", step 2). */
export async function loadEmployee(
  client: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
): Promise<LoadedEmployee | null> {
  const { data, error } = await client
    .from("employees")
    .select("id, org_id, name, identity")
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    throw new Error(`loadEmployee failed (${error.code ?? "unknown"}): ${error.message}`);
  }
  return data ?? null;
}

export interface RecentMessage {
  direction: "inbound" | "outbound";
  text: string;
  /** Who the exchange was with, when the event recorded one (#171). */
  counterparty?: Counterparty;
  /** Channel the event was on — lets the prompt label heartbeat notes (#174). */
  channel?: string;
}

/** A {@link RecentMessage} as read from the events table, for ordering/dedupe. */
export interface RecentRow extends RecentMessage {
  id: string;
  at: string;
}

/** Rows read per turn. Over-fetched: `system` rows are filtered out after. */
const FETCH_LIMIT = 40;

/** Message text allowed into the prompt (labels are added on top of this). */
const CHAR_BUDGET = 12_000;

/** Heartbeat reads across every channel, so it gets a tighter slice of each. */
const HEARTBEAT_CHAR_BUDGET = 6_000;

/**
 * Newest-first messages → the most recent ones that fit `budget`, oldest-first.
 * Always keeps the newest, even alone over budget: one pasted email thread must
 * not empty the window.
 */
export function fitRecent<T extends { text: string }>(newestFirst: T[], budget = CHAR_BUDGET): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const message of newestFirst) {
    used += message.text.length;
    if (used > budget && kept.length > 0) break;
    kept.push(message);
  }
  return kept.reverse();
}

/**
 * Whether this turn is with someone inside the company, which decides how much
 * of the employee's work its window shows. Internal counterparties see every
 * conversation plus the employee's own heartbeat notes; an external sender sees
 * only its own thread, so neither another customer's messages nor a note like
 * "followed up with Acme" can surface in its reply — #44's boundary stays
 * structural. An unresolved sender counts as external.
 */
export function isInternal(counterparty?: Counterparty): boolean {
  return counterparty?.kind === "manager" || counterparty?.kind === "coworker";
}

/** Merge two newest-first row sets into one budget-fitted, oldest-first window. */
export function mergeRecent(a: RecentRow[], b: RecentRow[], budget = CHAR_BUDGET): RecentRow[] {
  const newestFirst = [...a, ...b].sort((x, y) => y.at.localeCompare(x.at));
  return fitRecent(newestFirst, budget);
}

/**
 * The employee's recent message events, oldest-first — conversational context
 * for the turn (docs/architecture.md "The flow"), bounded by a character budget
 * rather than a message count (#127).
 *
 * Scoped to the person, not the channel (#174): a turn reads the messages
 * exchanged with its counterparty across every channel — matched on the
 * `address` stamped in the event payload — so a call yesterday is visible to
 * their email today, and nobody ever sees another sender's conversation (#44,
 * now structural). A turn with no resolved counterparty gets no history; its
 * context is Mem0 recall and knowledge.
 *
 * Internal turns also see the employee's own acted heartbeat notes
 * ({@link isInternal}). Heartbeat itself reads everything — every
 * conversation channel plus its own acted notes — on a tighter budget. No-op
 * heartbeat check-ins (no `acted` stamp) are noise and never appear anywhere.
 */
export async function recentMessages(
  client: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  channel: string,
  counterparty?: Counterparty,
  limit = FETCH_LIMIT,
): Promise<RecentMessage[]> {
  const read = async (
    scope: "with-person" | "conversations" | "acted-heartbeats",
  ): Promise<RecentRow[]> => {
    let query = client
      .from("events")
      .select("id, created_at, channel, payload")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("kind", "message");
    if (scope === "with-person") {
      query = query.eq("payload->counterparty->>address", counterparty?.address ?? "");
    } else if (scope === "conversations") {
      query = query.neq("channel", "heartbeat");
    } else {
      query = query
        .eq("channel", "heartbeat")
        .eq("payload->>direction", "outbound")
        .eq("payload->>acted", "true");
    }
    const { data } = await query.order("created_at", { ascending: false }).limit(limit);

    return (data ?? [])
      .map((row) => ({
        id: row.id,
        at: row.created_at,
        channel: row.channel,
        payload: row.payload as { direction?: unknown; text?: unknown; counterparty?: unknown },
      }))
      // `system` rows are degradation notices (#118), not conversation.
      .filter((r) => r.payload.direction === "inbound" || r.payload.direction === "outbound")
      .map(
        (r) =>
          ({
            id: r.id,
            at: r.at,
            channel: r.channel,
            direction: r.payload.direction,
            text: typeof r.payload.text === "string" ? r.payload.text : "",
            ...(typeof r.payload.counterparty === "object" && r.payload.counterparty !== null
              ? { counterparty: r.payload.counterparty as Counterparty }
              : {}),
          }) as RecentRow,
      )
      .filter((m) => m.text.length > 0);
  };

  if (channel === "heartbeat") {
    const [conversations, notes] = await Promise.all([
      read("conversations"),
      read("acted-heartbeats"),
    ]);
    return mergeRecent(conversations, notes, HEARTBEAT_CHAR_BUDGET);
  }

  if (!counterparty?.address) return [];
  // A manager asking what happened today needs the whole book of work, not just
  // its own thread (#273). Scoping everyone to their own thread was right for
  // customers and wrong for colleagues.
  const internal = isInternal(counterparty);
  const [conversation, notes] = await Promise.all([
    read(internal ? "conversations" : "with-person"),
    internal ? read("acted-heartbeats") : Promise.resolve([]),
  ]);
  return mergeRecent(conversation, notes, CHAR_BUDGET);
}
