import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentmailRetryable, VendorError, withDeadline, withRetry } from "./retry.js";

test("retries a rate-limited vendor request", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new VendorError("limited", 429, 0);
      return "ok";
    },
    { attempts: 2, isRetryable: (error) => error instanceof VendorError && error.status === 429 },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withDeadline returns the fallback when the work is too slow", async () => {
  const result = await withDeadline(
    () => new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 50)),
    5,
    "fallback",
  );
  assert.equal(result, "fallback");
});

test("withDeadline returns the fallback when the work throws", async () => {
  const result = await withDeadline(async () => {
    throw new Error("worker down");
  }, 50, "fallback");
  assert.equal(result, "fallback");
});

test("withDeadline returns the real value when the work is fast enough", async () => {
  const result = await withDeadline(async () => "real", 50, "fallback");
  assert.equal(result, "real");
});

test("does not retry a timeout", async () => {
  const error = new DOMException("timed out", "TimeoutError");
  let calls = 0;
  await assert.rejects(withRetry(async () => {
    calls++;
    throw error;
  }, { attempts: 2, isRetryable: isAgentmailRetryable }), error);
  assert.equal(calls, 1);
});
