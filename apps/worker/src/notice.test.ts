import { test } from "node:test";
import assert from "node:assert/strict";
import { addressee, cleanNotice, noticeAfter, FALLBACK_NOTICE } from "./notice.js";

test("noticeAfter: stop before the threshold never sends", async () => {
  let sent = false;
  const stop = noticeAfter(50, async () => {
    sent = true;
  });
  await stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sent, false);
});

test("noticeAfter: sends once when it outlives the threshold", async () => {
  let calls = 0;
  const stop = noticeAfter(5, async () => {
    calls++;
  });
  await new Promise((r) => setTimeout(r, 30));
  await stop();
  assert.equal(calls, 1);
});

test("noticeAfter: stop waits for an in-flight send to settle", async () => {
  let resolveSend: () => void = () => {};
  let settled = false;
  const stop = noticeAfter(5, () => {
    return new Promise<void>((resolve) => {
      resolveSend = () => {
        settled = true;
        resolve();
      };
    });
  });
  await new Promise((r) => setTimeout(r, 20));
  const stopped = stop();
  assert.equal(settled, false);
  resolveSend();
  await stopped;
  assert.equal(settled, true);
});

test("noticeAfter: stop gives up on a send that never settles", async () => {
  const stop = noticeAfter(5, () => new Promise<void>(() => {}), 20);
  await new Promise((r) => setTimeout(r, 15));
  const start = Date.now();
  await stop();
  assert.ok(Date.now() - start < 200);
});

test("noticeAfter: a rejecting send does not throw from stop", async () => {
  const stop = noticeAfter(5, async () => {
    throw new Error("boom");
  });
  await new Promise((r) => setTimeout(r, 20));
  await assert.doesNotReject(stop());
});

test("cleanNotice: strips markdown, wrapping quotes and dashes (#283)", () => {
  assert.equal(cleanNotice('"On it — pulling this together."'), "On it, pulling this together.");
  assert.equal(cleanNotice("Checking – one moment."), "Checking, one moment.");
});

test("cleanNotice: keeps only the first line", () => {
  assert.equal(cleanNotice("Looking into that now.\nWill follow up shortly."), "Looking into that now.");
});

test("cleanNotice: falls back on empty or over-long output", () => {
  assert.equal(cleanNotice(""), FALLBACK_NOTICE);
  assert.equal(cleanNotice("   "), FALLBACK_NOTICE);
  assert.equal(cleanNotice("x".repeat(500)), FALLBACK_NOTICE);
});

test("addressee: names an internal colleague", () => {
  assert.match(addressee({ kind: "manager", name: "Priya" }), /Priya, a colleague/);
  assert.match(addressee({ kind: "coworker", name: "Sam" }), /Sam, a colleague/);
});

test("addressee: says nothing for an unnamed colleague", () => {
  assert.equal(addressee({ kind: "coworker" }), "");
});

test("addressee: guards disclosure for external senders", () => {
  const external = addressee({ kind: "external", name: "Dana" });
  assert.match(external, /outside the company \(Dana\)/);
  assert.match(external, /Name no internal system/);
});

// An unresolved sender is treated as external, matching prompt.ts (#43).
test("addressee: treats an unresolved sender as external", () => {
  assert.match(addressee(undefined), /outside the company\./);
  assert.match(addressee(undefined), /Name no internal system/);
});
