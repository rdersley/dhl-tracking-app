import test from "node:test";
import assert from "node:assert/strict";
import { classifyDhlShipmentHttpFailure, sanitizeDhlErrorBody } from "../src/dhl-shipping-http-core.mjs";

test("sanitizes DHL error bodies and caps length", () => {
  assert.equal(sanitizeDhlErrorBody("  bad\n request\tdata  "), "bad request data");
  assert.equal(sanitizeDhlErrorBody("abcdefgh", 4), "abcd");
});

test("classifies validation errors as non-retryable", () => {
  const result = classifyDhlShipmentHttpFailure(400, "invalid receiver");
  assert.equal(result.kind, "validation");
  assert.equal(result.retryable, false);
  assert.match(result.message, /invalid receiver/);
});

test("classifies authentication failures without echoing secrets", () => {
  const result = classifyDhlShipmentHttpFailure(401, "credential detail that should not be shown");
  assert.equal(result.kind, "authentication");
  assert.equal(result.retryable, false);
  assert.doesNotMatch(result.message, /credential detail/);
});

test("classifies rate limits as retryable and preserves Retry-After", () => {
  const result = classifyDhlShipmentHttpFailure(429, "too many", "60");
  assert.equal(result.kind, "rate_limit");
  assert.equal(result.retryable, true);
  assert.equal(result.retryAfter, "60");
});

test("classifies server failures as retryable but warns against blind recreation", () => {
  const result = classifyDhlShipmentHttpFailure(503, "backend unavailable");
  assert.equal(result.kind, "service");
  assert.equal(result.retryable, true);
  assert.match(result.message, /check/i);
});
