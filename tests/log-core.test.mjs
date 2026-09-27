import test from "node:test";
import assert from "node:assert/strict";
import { summariseHttpError, responseErrorSummary } from "../src/log-core.mjs";

test("keeps only the first Jira error message", () => {
  const body = JSON.stringify({ errorMessages: ["Issue does not exist or you do not have permission to see it."], errors: {} });
  assert.equal(summariseHttpError(404, body), "HTTP 404: Issue does not exist or you do not have permission to see it.");
  const fieldBody = JSON.stringify({ errorMessages: [], errors: { customfield_1: "Field cannot be set.", summary: "Too long" } });
  assert.equal(summariseHttpError(400, fieldBody), "HTTP 400: Field cannot be set.");
});

test("uses the DHL problem title and caps long reasons", () => {
  assert.equal(summariseHttpError(404, JSON.stringify({ title: "No shipment with given tracking number found.", status: 404 })), "HTTP 404: No shipment with given tracking number found.");
  const long = summariseHttpError(400, JSON.stringify({ detail: "x".repeat(500) }));
  assert.ok(long.length < 140, long);
});

test("never logs non-JSON bodies", () => {
  assert.equal(summariseHttpError(502, "<html><body>Bad gateway for user@example.com</body></html>"), "HTTP 502");
  assert.equal(summariseHttpError(500, ""), "HTTP 500");
});

test("reads a failed response safely", async () => {
  assert.equal(await responseErrorSummary({ status: 403, text: async () => '{"errorMessages":["Forbidden"]}' }), "HTTP 403: Forbidden");
  assert.equal(await responseErrorSummary({ status: 500, text: async () => { throw new Error("stream"); } }), "HTTP 500");
});
