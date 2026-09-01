import test from "node:test";
import assert from "node:assert/strict";
import { buildEligibleIssueJql, deliveryDecision, safeDhlRuntimeConfig } from "../src/dhl-config-core.mjs";

const config = {
  sdProject: "SD",
  sdDispatchedStatus: "Dispatched",
  outForDeliveryStatus: "Out for Delivery",
  awaitingCollectionStatus: "Awaiting Collection",
  onHoldStatus: "On Hold",
  failedStatus: "Delivery Failed",
  trackingField: "customfield_10417",
  deliveryStatusField: "customfield_11952",
  lastDhlCheckField: "customfield_14400",
  dateSentField: "customfield_10433",
  deliveredValue: "Delivered",
  clientRestrictionEnabled: false,
};

test("eligible DHL JQL uses configured project, fields and statuses", () => {
  const jql = buildEligibleIssueJql(config);
  assert.match(jql, /project = "SD"/);
  assert.match(jql, /cf\[10417\] IS NOT EMPTY/);
  assert.match(jql, /"Dispatched"/);
  assert.match(jql, /"Out for Delivery"/);
  assert.match(jql, /cf\[11952\].*"Delivered"/);
  assert.match(jql, /ORDER BY cf\[14400\] ASC, cf\[10433\] ASC/);
});

test("client restriction is omitted when disabled", () => {
  const jql = buildEligibleIssueJql({ ...config, clientField: "customfield_12000", clientValues: ["A"] });
  assert.doesNotMatch(jql, /cf\[12000\] IN/);
});

test("client restriction uses configured field and values", () => {
  const jql = buildEligibleIssueJql({
    ...config,
    clientRestrictionEnabled: true,
    clientField: "customfield_12000",
    clientValues: ["Client A", "Client B"],
  });
  assert.match(jql, /cf\[12000\] IN \("Client A", "Client B"\)/);
});

test("invalid enabled client restriction fails closed", () => {
  assert.throws(() => buildEligibleIssueJql({ ...config, clientRestrictionEnabled: true, clientField: "", clientValues: [] }), /not fully configured/);
});

test("DHL analysis decisions use configured workflow status names", () => {
  assert.deepEqual(deliveryDecision({ outForDelivery: true }, config), {
    workflowStatus: "Out for Delivery",
    deliveryStatus: "Out for Delivery",
  });
  assert.deepEqual(deliveryDecision({ awaitingCollection: true }, config), {
    workflowStatus: "Awaiting Collection",
    deliveryStatus: "Awaiting Collection",
  });
  assert.deepEqual(deliveryDecision({ deliveryFailed: true }, config), {
    workflowStatus: "Delivery Failed",
    deliveryStatus: "Delivery Failed",
  });
});

test("in-transit updates delivery value without forcing Jira transition", () => {
  assert.deepEqual(deliveryDecision({ inTransit: true }, config), {
    workflowStatus: null,
    deliveryStatus: "In Transit",
  });
});

test("DHL runtime limits are clamped safely", () => {
  const safe = safeDhlRuntimeConfig({ ...config, maxResults: 999, dhlBatchSize: 0, dhlDelayMs: 10, minDaysSinceSent: -4 });
  assert.equal(safe.maxResults, 100);
  assert.equal(safe.dhlBatchSize, 10);
  assert.equal(safe.dhlDelayMs, 1000);
  assert.equal(safe.minDaysSinceSent, 0);
});
