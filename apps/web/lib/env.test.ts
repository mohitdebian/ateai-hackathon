import assert from "node:assert/strict";
import test from "node:test";
import { publicAppUrl } from "./env";

test("publicAppUrl prefers the configured public origin", () => {
  const previous = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://test.ate.ai/path";
  try {
    assert.equal(
      publicAppUrl(new Request("http://localhost:3000/api/employees")),
      "https://test.ate.ai",
    );
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previous;
  }
});
