import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeChunk } from "@ate/shared";
import { fitChunks, fitDocument, isContentless, resolveTitle } from "./knowledge.js";

const chunk = (score: number, chars = 100): KnowledgeChunk => ({
  doc_id: "00000000-0000-0000-0000-000000000000",
  title: "Handbook",
  content: "x".repeat(chars),
  score,
});

test("a non-query turn has nothing to retrieve on", () => {
  for (const query of [
    "thanks!",
    "ok",
    "Ok.",
    "Got it",
    "sounds good",
    "no worries",
    "will do",
    "will look into it",
    "I'll get back to you",
    "🙏",
    "❤️",
    "☺️",
    "👍🏽",
    "👨‍👩‍👧‍👦",
    "...!",
    "✓✓✓",
    "   ",
  ]) {
    assert.equal(isContentless(query), true, query);
  }
});

test("a real message is never contentless, even opening with an acknowledgement", () => {
  for (const query of [
    "what is the consolidated plan?",
    "ok, but what did legal say?",
    "thanks — send me the pricing tiers",
    "pricing?",
    "$100 plan",
    "follow up",
    "take a look",
  ]) {
    assert.equal(isContentless(query), false, query);
  }
});

test("drops the tail scoring far below the best match", () => {
  assert.deepEqual(
    fitChunks([chunk(0.72), chunk(0.66), chunk(0.5)]).map((c) => c.score),
    [0.72, 0.66],
  );
});

test("stops at the character budget", () => {
  assert.equal(fitChunks([chunk(0.5, 400), chunk(0.5, 400), chunk(0.5, 400)], 900).length, 2);
});

test("keeps the top chunk even when it alone busts the budget", () => {
  assert.equal(fitChunks([chunk(0.5, 50_000)], 6_000).length, 1);
});

test("empty in, empty out", () => {
  assert.deepEqual(fitChunks([]), []);
});

test("resolves a title case- and whitespace-insensitively", () => {
  const available = ["Systems_assignment", "Handbook"];
  assert.equal(resolveTitle("systems_assignment", available), "Systems_assignment");
  assert.equal(resolveTitle("  Handbook  ", available), "Handbook");
});

test("an unknown title resolves to null, not a throw", () => {
  assert.equal(resolveTitle("nope", ["Handbook"]), null);
});

test("joins document chunks in order", () => {
  assert.equal(fitDocument(["one", "two", "three"]), "one\n\ntwo\n\nthree");
});

test("truncates an oversized document with a note", () => {
  const result = fitDocument(["x".repeat(50), "y".repeat(50)], 60);
  assert.ok(result.length < 200);
  assert.match(result, /truncated/);
  assert.ok(result.startsWith("x".repeat(50)));
});
