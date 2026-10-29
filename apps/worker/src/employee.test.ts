import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@ate/shared";
import {
  fitRecent,
  recentMessages,
  mergeRecent,
  isInternal,
  type RecentMessage,
  type RecentRow,
} from "./employee.js";

const msg = (text: string, direction: RecentMessage["direction"] = "inbound"): RecentMessage => ({
  direction,
  text,
});

const row = (id: string, at: string, text: string): RecentRow => ({
  id,
  at,
  direction: "inbound",
  text,
});

test("returns oldest-first", () => {
  const newestFirst = [msg("third"), msg("second"), msg("first")];
  assert.deepEqual(
    fitRecent(newestFirst, 100).map((m) => m.text),
    ["first", "second", "third"],
  );
});

test("drops the oldest messages when over budget, never the newest", () => {
  const newestFirst = [msg("c".repeat(10)), msg("b".repeat(10)), msg("a".repeat(10))];
  assert.deepEqual(
    fitRecent(newestFirst, 20).map((m) => m.text[0]),
    ["b", "c"],
  );
});

test("keeps the newest message even when it alone busts the budget", () => {
  const newestFirst = [msg("x".repeat(50_000)), msg("older")];
  const kept = fitRecent(newestFirst, 100);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.text.length, 50_000);
});

test("keeps everything when it fits", () => {
  const newestFirst = [msg("b", "outbound"), msg("a")];
  assert.deepEqual(fitRecent(newestFirst, 100), [msg("a"), msg("b", "outbound")]);
});

test("empty in, empty out", () => {
  assert.deepEqual(fitRecent([], 100), []);
});

test("merges conversation and heartbeat notes by recency, oldest-first out", () => {
  // Newest-first inputs, interleaved timestamps across the two sets.
  const withThem = [row("c3", "t5", "reply"), row("c1", "t1", "hello")];
  const notes = [row("h2", "t3", "sent the report")];
  assert.deepEqual(
    mergeRecent(withThem, notes, 100).map((r) => r.id),
    ["c1", "h2", "c3"],
  );
});

test("merge drops the oldest rows when over budget, wherever they came from", () => {
  const withThem = [row("c2", "t4", "b".repeat(10)), row("c1", "t1", "a".repeat(10))];
  const notes = [row("h1", "t2", "n".repeat(10))];
  // Budget fits two of three: the oldest (c1) falls out first.
  assert.deepEqual(
    mergeRecent(withThem, notes, 20).map((r) => r.id),
    ["h1", "c2"],
  );
});

test("merge with an empty side is plain recency fill", () => {
  const rows = [row("z", "t3", "z".repeat(10)), row("y", "t2", "y".repeat(10)), row("x", "t1", "x".repeat(10))];
  assert.deepEqual(
    mergeRecent(rows, [], 20).map((r) => r.id),
    ["y", "z"],
  );
});

test("only internal counterparties see heartbeat activity notes", () => {
  assert.equal(isInternal({ kind: "manager" }), true);
  assert.equal(isInternal({ kind: "coworker" }), true);
  assert.equal(isInternal({ kind: "external" }), false);
  // An unresolved sender is treated as a stranger, not as staff.
  assert.equal(isInternal(undefined), false);
});

/** Captures the REST query recentMessages builds, so the window's scope is testable. */
function capturing() {
  const urls: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    urls.push(request.url);
    return Response.json([]);
  };
  const client = createClient<Database>("https://supabase.test", "service-role", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchMock },
  });
  return { urls, client };
}

const ADDRESS_FILTER = "counterparty-%3E%3Eaddress";

test("a colleague's turn reads every conversation, not just their own thread (#273)", async () => {
  const { urls, client } = capturing();
  await recentMessages(client, "org-1", "employee-1", "slack", {
    kind: "manager",
    address: "manager@example.com",
  });
  assert.ok(urls.some((u) => u.includes("channel=neq.heartbeat")));
  assert.ok(!urls.some((u) => u.includes(ADDRESS_FILTER)));
});

test("an outsider's turn still sees only its own thread (#44)", async () => {
  const { urls, client } = capturing();
  await recentMessages(client, "org-1", "employee-1", "email", {
    kind: "external",
    address: "customer@acme.com",
  });
  assert.ok(urls.some((u) => u.includes(ADDRESS_FILTER)));
  assert.ok(!urls.some((u) => u.includes("channel=neq.heartbeat")));
});
