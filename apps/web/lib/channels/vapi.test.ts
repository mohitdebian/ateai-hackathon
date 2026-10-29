import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestedAreaCodes } from "./vapi.js";

test("takes the area codes Vapi names when the wanted one has no free numbers", () => {
  const body =
    '{"message":"This area code is currently not available. Hint: Try one of 859, 912, 708.",' +
    '"error":"Bad Request","statusCode":400}';
  assert.deepEqual(suggestedAreaCodes(body), ["859", "912", "708"]);
});

test("a rejection with no hint suggests nothing, so the error surfaces", () => {
  const body = '{"message":["At least one of numberDesiredAreaCode, sipUri must be provided"]}';
  assert.deepEqual(suggestedAreaCodes(body), []);
});
