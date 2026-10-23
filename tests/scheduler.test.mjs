import test from "node:test";
import assert from "node:assert/strict";
import { schedulerPlan, shouldRunDhl } from "../src/scheduler-core.mjs";

test("DHL runs once every three five-minute buckets", () => {
  const base = Date.UTC(2026, 7, 31, 10, 0, 0);
  const results = [0, 5, 10, 15, 20, 25, 30].map((minutes) =>
    shouldRunDhl(base + minutes * 60 * 1000)
  );

  assert.deepEqual(results, [true, false, false, true, false, false, true]);
});

test("DHL cadence is stable within the same five-minute bucket", () => {
  const due = Date.UTC(2026, 7, 31, 10, 15, 0);
  assert.equal(shouldRunDhl(due), true);
  assert.equal(shouldRunDhl(due + 4 * 60 * 1000 + 59 * 1000), true);
});

test("scheduler runs tracking and reconciliation unless switched off", () => {
  assert.deepEqual(schedulerPlan({}), { hardware: true, dhl: true });
  assert.deepEqual(schedulerPlan({ dhlTrackingEnabled: false }), { hardware: true, dhl: false });
  assert.deepEqual(schedulerPlan({ hwReconciliationEnabled: false }), { hardware: false, dhl: true });
  assert.deepEqual(schedulerPlan({ dhlTrackingEnabled: false, hwReconciliationEnabled: false }), { hardware: false, dhl: false });
});
