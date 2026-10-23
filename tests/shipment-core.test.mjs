import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DHL_LABEL_BASE64_CHARS,
  buildMyDhlShipmentPayload,
  buildCreatedShipmentRecord,
  buildPendingShipmentRecord,
  buildShipmentRepairPlan,
  buildShipmentWriteback,
  extractMyDhlShipmentResult,
  formatMyDhlDateTime,
  isDefinitiveShipmentFailure,
  normalizeCountryCode,
  requiresCustomsDeclaration,
  shipmentRecordState,
  validateShipmentDraft,
} from "../src/shipment-core.mjs";

const config = {
  dhlShippingAccountNumber: "123456789",
  dhlProductCode: "P",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  deliveryStatusField: "customfield_11952",
  inTransitValue: "In Transit",
};

const draft = {
  reference: "SD-123",
  shipper: {
    name: "Warehouse Team",
    company: "Nuvriqo Test",
    address1: "1 Warehouse Road",
    city: "Dublin",
    postalCode: "D01TEST",
    countryCode: "ie",
    phone: "+35310000000",
    email: "warehouse@example.com",
  },
  receiver: {
    name: "Test Recipient",
    address1: "2 Customer Road",
    city: "Cork",
    postalCode: "T12TEST",
    countryCode: "IE",
  },
  package: { weightKg: 2.5, lengthCm: 40, widthCm: 30, heightCm: 20, description: "Replacement laptop" },
  contentsDescription: "Replacement IT hardware",
  pickupRequested: false,
};

test("normalizes country codes", () => {
  assert.equal(normalizeCountryCode(" ie "), "IE");
});

test("valid shipment draft passes validation", () => {
  assert.deepEqual(validateShipmentDraft(draft, config), { ok: true, errors: [] });
});

test("shipment validation fails closed when required data is absent", () => {
  const result = validateShipmentDraft({ receiver: {}, shipper: {}, package: {} }, {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 10);
  assert.ok(result.errors.some((message) => message.includes("DHL shipping account number")));
  assert.ok(result.errors.some((message) => message.includes("Package weight")));
});

test("customs-declarable shipments fail closed until customs line items are supported", () => {
  const result = validateShipmentDraft({ ...draft, isCustomsDeclarable: true }, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("Customs-declarable shipments")));
});

test("builds MyDHL Express create-shipment payload without hardcoded recipient data", () => {
  const payload = buildMyDhlShipmentPayload(draft, config, new Date("2026-09-05T12:00:00Z"));
  assert.equal(payload.productCode, "P");
  assert.deepEqual(payload.accounts, [{ typeCode: "shipper", number: "123456789" }]);
  assert.equal(payload.customerDetails.shipperDetails.postalAddress.countryCode, "IE");
  assert.equal(payload.customerDetails.receiverDetails.contactInformation.fullName, "Test Recipient");
  assert.equal(payload.content.packages[0].weight, 2.5);
  assert.equal(payload.content.packages[0].customerReferences[0].value, "SD-123");
  assert.equal(payload.pickup.isRequested, false);
  assert.equal(payload.content.isCustomsDeclarable, false);
});

test("extracts tracking number and label details from shipment response", () => {
  const result = extractMyDhlShipmentResult({
    shipmentTrackingNumber: "1234567890",
    dispatchConfirmationNumber: "ABC123",
    documents: [{ typeCode: "label", imageFormat: "PDF", content: "JVBERi0=" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.trackingNumber, "1234567890");
  assert.equal(result.dispatchConfirmationNumber, "ABC123");
  assert.equal(result.labelFormat, "PDF");
  assert.equal(result.labelBase64, "JVBERi0=");
  assert.equal(result.labelTooLarge, false);
});

test("oversized DHL labels are not retained in memory for attachment", () => {
  const result = extractMyDhlShipmentResult({
    shipmentTrackingNumber: "1234567890",
    documents: [{ typeCode: "label", imageFormat: "PDF", content: "A".repeat(MAX_DHL_LABEL_BASE64_CHARS + 1) }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.labelTooLarge, true);
  assert.equal(result.labelBase64, "");
});

test("shipment response without tracking number is not treated as successfully usable", () => {
  assert.equal(extractMyDhlShipmentResult({ documents: [] }).ok, false);
});

test("builds Jira writeback fields after DHL accepts shipment", () => {
  const fields = buildShipmentWriteback({ trackingNumber: "JD0001" }, config);
  assert.equal(fields.customfield_10417, "JD0001");
  assert.deepEqual(fields.customfield_11952, { value: "In Transit" });
  assert.match(fields.customfield_10433, /^\d{4}-\d{2}-\d{2}$/);
});

test("customs is required from country codes even when the checkbox is unticked", () => {
  const to = (countryCode) => ({ ...draft, receiver: { ...draft.receiver, countryCode }, isCustomsDeclarable: false });
  assert.equal(requiresCustomsDeclaration(draft), false); // IE -> IE
  assert.equal(requiresCustomsDeclaration(to("DE")), false); // EU -> EU
  assert.equal(requiresCustomsDeclaration(to("GB")), true);
  assert.equal(requiresCustomsDeclaration(to("US")), true);
  assert.equal(requiresCustomsDeclaration(to("CH")), true);
  assert.equal(requiresCustomsDeclaration({ ...draft, isCustomsDeclarable: true }), true);

  const result = validateShipmentDraft(to("GB"), config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("Customs-declarable shipments")));
  assert.throws(() => buildMyDhlShipmentPayload(to("US"), config));
});

test("planned shipping time uses the MyDHL GMT offset format", () => {
  const now = new Date("2026-09-05T12:00:00.123Z");
  assert.equal(formatMyDhlDateTime(undefined, now), "2026-09-05T12:10:00GMT+00:00");
  assert.equal(formatMyDhlDateTime("2026-09-06T08:30:00Z", now), "2026-09-06T08:30:00GMT+00:00");
  assert.equal(formatMyDhlDateTime("2026-09-06T09:30:00GMT+01:00", now), "2026-09-06T09:30:00GMT+01:00");
  assert.equal(formatMyDhlDateTime("not a date", now), "2026-09-05T12:10:00GMT+00:00");
  const payload = buildMyDhlShipmentPayload(draft, config, now);
  assert.match(payload.plannedShippingDateAndTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}GMT[+-]\d{2}:\d{2}$/);
});

test("shipment record states block duplicates while a request is pending", () => {
  assert.equal(shipmentRecordState(null), "none");
  assert.equal(shipmentRecordState(buildPendingShipmentRecord("req-1")), "pending");
  assert.equal(shipmentRecordState(buildCreatedShipmentRecord({ trackingNumber: "JD1" })), "created");
  assert.equal(shipmentRecordState({ trackingNumber: "JD1", createdAt: "2026-09-01T00:00:00Z" }), "created"); // pre-existing records
  assert.equal(shipmentRecordState({ createdAt: "2026-09-01T00:00:00Z" }), "invalid");
});

test("only definite DHL rejections release a pending shipment request", () => {
  for (const status of [400, 401, 403, 409, 422, 429]) assert.equal(isDefinitiveShipmentFailure(status), true, String(status));
  for (const status of [0, 408, 500, 502, 503, 504]) assert.equal(isDefinitiveShipmentFailure(status), false, String(status));
});

test("repair does nothing when the ticket already shows the recorded tracking number", () => {
  const fields = {
    customfield_10417: "JD0001",
    customfield_10433: "2026-09-01",
    customfield_11952: { value: "Delivered" },
  };
  const plan = buildShipmentRepairPlan(fields, { trackingNumber: "JD0001", createdAt: "2026-09-01T10:00:00Z" }, config);
  assert.deepEqual(plan, { action: "none", trackingNumber: "JD0001" });
});

test("repair fills only missing fields and keeps existing Date Sent and Delivery Status", () => {
  const recorded = { trackingNumber: "JD0001", createdAt: "2026-09-01T10:00:00Z" };
  const kept = buildShipmentRepairPlan({ customfield_10433: "2026-08-30", customfield_11952: { value: "Delivered" } }, recorded, config);
  assert.equal(kept.action, "repair");
  assert.deepEqual(kept.fields, { customfield_10417: "JD0001" });

  const empty = buildShipmentRepairPlan({}, recorded, config);
  assert.deepEqual(empty.fields, {
    customfield_10417: "JD0001",
    customfield_10433: "2026-09-01",
    customfield_11952: { value: "In Transit" },
  });
});

test("repair refuses to overwrite a different tracking number on the ticket", () => {
  const plan = buildShipmentRepairPlan({ customfield_10417: "OTHER" }, { trackingNumber: "JD0001" }, config);
  assert.equal(plan.action, "conflict");
  assert.equal(buildShipmentRepairPlan({}, {}, config).action, "invalid");
});
