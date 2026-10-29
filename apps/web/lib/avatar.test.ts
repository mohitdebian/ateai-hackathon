import assert from "node:assert/strict";
import test from "node:test";
import { avatarTint, initials } from "./avatar";

test("keeps initials and tints stable for a name", () => {
  assert.equal(initials("Maya Chen"), "MC");
  assert.deepEqual(avatarTint("Maya Chen"), avatarTint("maya chen"));
  assert.notDeepEqual(avatarTint("Maya Chen"), avatarTint("Noah Singh"));
});
