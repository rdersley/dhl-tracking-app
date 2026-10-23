import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDispatchRepair,
  buildHardwareCreateFields,
  buildHardwareDuplicateState,
} from "../src/hardware-core.mjs";
import {
  analyseDHLStatuses,
  collectStatusStrings,
} from "../src/core.mjs";
import { deliveryDecision } from "../src/dhl-config-core.mjs";

const config = {
  sdProject: "SD",
  hwProject: "HW",
  hwIssueType: "Task",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  sdDispatchedStatus: "Dispatched",
  outForDeliveryStatus: "Out for Delivery",
  awaitingCollectionStatus: "Awaiting Collection",
  onHoldStatus: "On Hold",
  failedStatus: "Delivery Failed",
  deliveredValue: "Delivered",
  inTransitValue: "In Transit",
  outForDeliveryValue: "Out for Delivery",
  awaitingCollectionValue: "Awaiting Collection",
  onHoldValue: "On Hold",
  failedValue: "Delivery Failed",
  hwFieldMappings: [
    { source: "customfield_20001", target: "customfield_30001" },
    { source: "customfield_20002", target: "customfield_30002" },
  ],
};

test("full happy path: SD handover builds HW ticket, dispatch repairs SD, DHL reaches out-for-delivery", () => {
  const sd = {
    key: "SD-100",
    fields: {
      summary: "Replace faulty iPad",
      description: { type: "doc" },
      customfield_20001: "DEVICE-123",
      customfield_20002: { value: "Client A" },
      issuelinks: [],
      status: { name: "Sent to Hardware" },
      [config.trackingField]: null,
      [config.dateSentField]: null,
    },
  };

  assert.equal(buildHardwareDuplicateState(sd, config.hwProject).duplicate, false);
  assert.deepEqual(buildHardwareCreateFields(sd, sd.key, config), {
    project: { key: "HW" },
    issuetype: { name: "Task" },
    summary: "Replace faulty iPad",
    description: { type: "doc" },
    customfield_30001: "DEVICE-123",
    customfield_30002: { value: "Client A" },
  });

  const hw = {
    key: "HW-200",
    fields: {
      [config.trackingField]: "JD014600006281001234",
      [config.dateSentField]: "2026-09-05",
    },
  };

  const repair = buildDispatchRepair(hw, sd, config);
  assert.equal(repair.ready, true);
  assert.equal(repair.transition, true);
  assert.equal(repair.fields[config.trackingField], "JD014600006281001234");
  assert.equal(repair.fields[config.dateSentField], "2026-09-05");

  const shipment = {
    status: { status: "In transit" },
    events: [{ status: "Out for delivery", description: "With delivery courier" }],
  };
  const decision = deliveryDecision(analyseDHLStatuses(collectStatusStrings(shipment)), config);
  assert.deepEqual(decision, {
    workflowStatus: "Out for Delivery",
    deliveryStatus: "Out for Delivery",
  });
});

test("repeat handover is idempotent when an HW issue is already linked", () => {
  const sd = { fields: { issuelinks: [{ outwardIssue: { key: "HW-200" } }] } };
  const duplicate = buildHardwareDuplicateState(sd, "HW");
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.existingKeys, ["HW-200"]);
});

test("failed link still blocks duplicate creation because recorded HW key is retained", () => {
  const sd = { fields: { issuelinks: [] } };
  const duplicate = buildHardwareDuplicateState(sd, "HW", ["HW-201"]);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.linkedKeys, []);
  assert.deepEqual(duplicate.recordedIssueKeys, ["HW-201"]);
});

test("dispatch reconciliation is a no-op once SD tracking, date and status already match", () => {
  const hw = { fields: { [config.trackingField]: "ABC123", [config.dateSentField]: "2026-09-05" } };
  const sd = { fields: { [config.trackingField]: "ABC123", [config.dateSentField]: "2026-09-05", status: { name: "Dispatched" } } };
  assert.deepEqual(buildDispatchRepair(hw, sd, config), { ready: true, fields: {}, transition: false });
});

test("DHL in-transit state updates delivery status without forcing a workflow transition", () => {
  const shipment = { events: [{ description: "Processed at facility" }] };
  const decision = deliveryDecision(analyseDHLStatuses(collectStatusStrings(shipment)), config);
  assert.deepEqual(decision, { workflowStatus: null, deliveryStatus: "In Transit" });
});

test("DHL awaiting-collection state maps to configured Jira workflow", () => {
  const shipment = { events: [{ description: "Ready for collection" }] };
  const decision = deliveryDecision(analyseDHLStatuses(collectStatusStrings(shipment)), config);
  assert.deepEqual(decision, { workflowStatus: "Awaiting Collection", deliveryStatus: "Awaiting Collection" });
});

test("DHL hold/exception state maps to configured Jira workflow", () => {
  const shipment = { events: [{ description: "Clearance event" }] };
  const decision = deliveryDecision(analyseDHLStatuses(collectStatusStrings(shipment)), config);
  assert.deepEqual(decision, { workflowStatus: "On Hold", deliveryStatus: "On Hold" });
});

test("DHL delivery failure and return-to-sender both map to failure workflow", () => {
  const failed = deliveryDecision(analyseDHLStatuses(["recipient not home"]), config);
  const returned = deliveryDecision(analyseDHLStatuses(["shipment returned to shipper"]), config);
  assert.deepEqual(failed, { workflowStatus: "Delivery Failed", deliveryStatus: "Delivery Failed" });
  assert.deepEqual(returned, { workflowStatus: "Delivery Failed", deliveryStatus: "Delivery Failed" });
});

test("delivered detection wins at the runtime decision boundary", () => {
  const analysis = analyseDHLStatuses(collectStatusStrings({ events: [{ status: "Delivered" }] }));
  assert.equal(analysis.delivered, true);
});

test("past customs history does not hold a shipment that is now out for delivery", () => {
  const shipment = {
    status: { statusCode: "transit", description: "With delivery courier" },
    events: [
      { timestamp: "2026-09-24T08:10:00", description: "With delivery courier" },
      { timestamp: "2026-09-23T15:00:00", description: "Customs clearance status updated" },
    ],
  };
  const decision = deliveryDecision(analyseDHLStatuses(collectStatusStrings(shipment)), config);
  assert.deepEqual(decision, { workflowStatus: "Out for Delivery", deliveryStatus: "Out for Delivery" });
});

test("could-not-be-delivered is routed to the failure workflow, never resolved as delivered", () => {
  const shipment = {
    status: { statusCode: "failure", description: "The shipment could not be delivered" },
    events: [{ timestamp: "2026-09-24T12:00:00", description: "The shipment could not be delivered" }],
  };
  const analysis = analyseDHLStatuses(collectStatusStrings(shipment));
  assert.equal(analysis.delivered, false);
  assert.deepEqual(deliveryDecision(analysis, config), { workflowStatus: "Delivery Failed", deliveryStatus: "Delivery Failed" });
});
