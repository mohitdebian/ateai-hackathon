import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText } from "./format.js";

test("strips bold", () => {
  assert.equal(plainText("This is **bold** and __also bold__."), "This is bold and also bold.");
});

test("strips inline and fenced code", () => {
  assert.equal(plainText("Run `npm install` please."), "Run npm install please.");
  assert.equal(plainText("```js\nconst x = 1;\n```"), "const x = 1;");
});

test("strips headings", () => {
  assert.equal(plainText("### Next steps\nDo the thing."), "Next steps\nDo the thing.");
});

test("strips links", () => {
  assert.equal(plainText("See [the doc](https://example.com/doc) for details."), "See the doc (https://example.com/doc) for details.");
});

test("strips links whose URL contains balanced parens", () => {
  assert.equal(
    plainText("See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) for more."),
    "See wiki (https://en.wikipedia.org/wiki/Foo_(bar)) for more.",
  );
});

test("leaves em and en dashes untouched", () => {
  assert.equal(plainText("We shipped it — finally."), "We shipped it — finally.");
  assert.equal(plainText("pages 10–20"), "pages 10–20");
});

test("leaves snake_case identifiers untouched", () => {
  assert.equal(plainText("The tool is gmail_send_email on the events table."), "The tool is gmail_send_email on the events table.");
});

test("leaves bullet lists untouched", () => {
  assert.equal(plainText("- first item\n- second item"), "- first item\n- second item");
});
