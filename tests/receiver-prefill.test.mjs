import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReceiverPrefill,
  cleanReceiverFieldMap,
  fieldValueText,
  mergeReceiverPrefill,
  normaliseCountryInput,
  receiverSourceFields,
} from "../src/receiver-prefill-core.mjs";
import { getLinkedIssueKeys } from "../src/hardware-core.mjs";
import { validateShipmentDraft } from "../src/shipment-core.mjs";

const map = {
  name: "reporter",
  company: "customfield_10115",
  address1: "customfield_20001",
  city: "customfield_20002",
  postalCode: "customfield_20003",
  countryCode: "customfield_20004",
  phone: "customfield_20005",
  email: "reporterEmail",
};

const sdIssue = {
  key: "SD-100",
  fields: {
    reporter: { displayName: "Jane Crew", emailAddress: "jane@example.com" },
    customfield_10115: { value: "RYR - Ryanair" },
    customfield_20001: "  Unit 4, Airport Business Park  ",
    customfield_20002: "Dublin",
    customfield_20003: "K67 A1B2",
    customfield_20004: { value: "Ireland" },
    customfield_20005: "",
  },
};

test("only known receiver parts with plausible field ids are kept", () => {
  assert.deepEqual(cleanReceiverFieldMap({ name: "reporter", city: "customfield_1", bogus: "customfield_2", phone: "", email: "bad id!" }), { name: "reporter", city: "customfield_1" });
  assert.deepEqual(cleanReceiverFieldMap(null), {});
  assert.deepEqual(cleanReceiverFieldMap(["reporter"]), {});
});

test("source fields are de-duplicated and reporter email reads the reporter field", () => {
  assert.deepEqual(receiverSourceFields(map).sort(), ["customfield_10115", "customfield_20001", "customfield_20002", "customfield_20003", "customfield_20004", "customfield_20005", "reporter"].sort());
  assert.deepEqual(receiverSourceFields({}), []);
});

test("field values of common Jira types become text", () => {
  assert.equal(fieldValueText("Dublin"), "Dublin");
  assert.equal(fieldValueText(42), "42");
  assert.equal(fieldValueText({ value: "Ireland" }), "Ireland");
  assert.equal(fieldValueText({ value: "Ireland", child: { value: "Dublin" } }), "Ireland - Dublin");
  assert.equal(fieldValueText({ displayName: "Jane Crew" }), "Jane Crew");
  assert.equal(fieldValueText([{ value: "A" }, { value: "B" }]), "A, B");
  assert.equal(fieldValueText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Unit 4" }, { type: "hardBreak" }, { type: "text", text: "Airport Park" }] }] }).trim(), "Unit 4\nAirport Park");
  assert.equal(fieldValueText(null), "");
});

test("country names are converted to DHL codes and codes pass through", () => {
  assert.equal(normaliseCountryInput("Ireland"), "IE");
  assert.equal(normaliseCountryInput(" united kingdom "), "GB");
  assert.equal(normaliseCountryInput("de"), "DE");
  assert.equal(normaliseCountryInput("Atlantis"), "Atlantis");
});

test("builds the receiver from the linked SD ticket", () => {
  const { receiver, filled } = buildReceiverPrefill(sdIssue, { fields: {} }, map);
  assert.deepEqual(receiver, {
    name: "Jane Crew",
    company: "RYR - Ryanair",
    address1: "Unit 4, Airport Business Park",
    city: "Dublin",
    postalCode: "K67 A1B2",
    countryCode: "IE",
    email: "jane@example.com",
  });
  assert.ok(!filled.includes("phone"), "empty SD values are not filled");
});

test("falls back to the hardware ticket's own field when SD has no value or no link", () => {
  const hwIssue = { fields: { customfield_20005: "+353 1 000 0000", customfield_20002: "Cork" } };
  assert.equal(buildReceiverPrefill(sdIssue, hwIssue, map).receiver.phone, "+353 1 000 0000");
  assert.equal(buildReceiverPrefill(sdIssue, hwIssue, map).receiver.city, "Dublin", "SD wins when it has a value");
  assert.deepEqual(buildReceiverPrefill(null, hwIssue, map).receiver, { city: "Cork", phone: "+353 1 000 0000" });
});

test("multi-line address text is flattened to one line", () => {
  const issue = { fields: { customfield_20001: "Unit 4\n\nAirport Business Park\n" } };
  assert.equal(buildReceiverPrefill(issue, null, { address1: "customfield_20001" }).receiver.address1, "Unit 4, Airport Business Park");
});

test("prefill only replaces untouched form defaults", () => {
  const defaults = { name: "", city: "", countryCode: "IE" };
  const current = { name: "Typed by agent", city: "", countryCode: "IE" };
  const merged = mergeReceiverPrefill(current, { name: "Jane Crew", city: "Dublin", countryCode: "GB" }, defaults);
  assert.deepEqual(merged, { name: "Typed by agent", city: "Dublin", countryCode: "GB" });
});

test("the linked SD ticket is found from the hardware ticket's issue links", () => {
  const hwIssue = { fields: { issuelinks: [{ inwardIssue: { key: "SD-100" } }, { outwardIssue: { key: "HW-7" } }, { outwardIssue: { key: "SD-101" } }] } };
  assert.deepEqual(getLinkedIssueKeys(hwIssue, "SD"), ["SD-100", "SD-101"]);
});

test("a prefilled receiver passes shipment validation", () => {
  const { receiver } = buildReceiverPrefill(sdIssue, null, map);
  const draft = {
    reference: "HW-1",
    shipper: { name: "Warehouse", address1: "1 Road", city: "Dublin", postalCode: "D01", countryCode: "IE" },
    receiver,
    package: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  };
  assert.deepEqual(validateShipmentDraft(draft, { dhlShippingAccountNumber: "1", dhlProductCode: "N" }), { ok: true, errors: [] });
});
