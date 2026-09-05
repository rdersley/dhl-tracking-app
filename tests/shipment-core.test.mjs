import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DHL_LABEL_BASE64_CHARS,
  buildMyDhlShipmentPayload,
  buildShipmentWriteback,
  extractMyDhlShipmentResult,
  normalizeCountryCode,
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
