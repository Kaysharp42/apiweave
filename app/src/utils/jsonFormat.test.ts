import assert from "node:assert/strict";
import { test } from "vitest";
import { tryFormatJson } from "./jsonFormat";

test("tryFormatJson indents a minified body", () => {
  const { success, result } = tryFormatJson('{"city":"Paris","zip":"75001"}');
  assert.equal(success, true);
  assert.equal(result, '{\n  "city": "Paris",\n  "zip": "75001"\n}');
});

test("tryFormatJson is idempotent — a second click never minifies", () => {
  const once = tryFormatJson('{"city":"Paris","zip":"75001"}').result;
  assert.equal(tryFormatJson(once).result, once);
});

test("tryFormatJson leaves invalid JSON (templates) untouched", () => {
  const templated = '{"count": {{env.COUNT}}}';
  assert.deepEqual(tryFormatJson(templated), {
    success: false,
    result: templated,
  });
});
