import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument, UnsupportedFileError, FileTooLargeError } from "./document.js";

test("parses plain text", async () => {
  const buf = Buffer.from("hello text");
  const res = await parseDocument(buf, "text/plain", "test.txt");
  assert.equal(res, "hello text");
});

test("throws on large files", async () => {
  const buf = Buffer.alloc(11 * 1024 * 1024);
  await assert.rejects(parseDocument(buf, "text/plain", "large.txt"), FileTooLargeError);
});

test("throws on unsupported files", async () => {
  const buf = Buffer.from("fake data");
  await assert.rejects(parseDocument(buf, "application/octet-stream", "fake.bin"), UnsupportedFileError);
});
