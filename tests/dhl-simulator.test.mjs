import test from "node:test";
import assert from "node:assert/strict";
import {
  SIMULATION_OUTCOMES,
  buildSimulatedPdf,
  cleanSimulationOutcome,
  isSimulatedTrackingNumber,
  simulateMyDhlCreateShipment,
  simulatedTrackingNumber,
} from "../src/dhl-simulator.mjs";
import { buildMyDhlShipmentPayload, extractMyDhlShipmentResult, isDefinitiveShipmentFailure } from "../src/shipment-core.mjs";
import { classifyDhlShipmentHttpFailure } from "../src/dhl-shipping-http-core.mjs";

const config = { dhlShippingAccountNumber: "SIMULATED", dhlProductCode: "P" };
const draft = {
  reference: "HW-42",
  shipper: { name: "Warehouse", address1: "1 Road", city: "Dublin", postalCode: "D01", countryCode: "IE" },
  receiver: { name: "Crew Base", address1: "2 Road", city: "Cork", postalCode: "T12", countryCode: "IE" },
  package: { weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 },
};

test("simulated tracking numbers are recognisable and never look like real DHL numbers", () => {
  const number = simulatedTrackingNumber(() => 0.5);
  assert.equal(number, "SIM-5555555555");
  assert.equal(isSimulatedTrackingNumber(number), true);
  assert.equal(isSimulatedTrackingNumber(" sim-123 "), true);
  assert.equal(isSimulatedTrackingNumber("1234567890"), false);
  assert.equal(isSimulatedTrackingNumber(null), false);
});

test("unknown simulation outcomes fall back to success", () => {
  assert.equal(cleanSimulationOutcome("nonsense"), "success");
  assert.equal(cleanSimulationOutcome("timeout"), "timeout");
  assert.ok(Object.keys(SIMULATION_OUTCOMES).includes("outage"));
});

test("simulated success returns a tracking number and the requested documents", () => {
  const request = buildMyDhlShipmentPayload(draft, { ...config, dhlAttachReceipt: true });
  const simulated = simulateMyDhlCreateShipment(request, "success", () => 0.1);
  assert.equal(simulated.status, 201);

  const result = extractMyDhlShipmentResult(JSON.parse(simulated.body));
  assert.equal(result.ok, true);
  assert.equal(result.trackingNumber, "SIM-1111111111");
  assert.deepEqual(result.documents.map((document) => document.kind), ["label", "waybill", "receipt"]);
  assert.ok(result.documents.every((document) => !document.tooLarge));
});

test("simulated failures map onto the real failure handling", () => {
  const request = buildMyDhlShipmentPayload(draft, config);
  assert.deepEqual(simulateMyDhlCreateShipment(request, "timeout"), { networkError: true });

  const rejected = simulateMyDhlCreateShipment(request, "rejected");
  assert.equal(rejected.status, 400);
  assert.equal(isDefinitiveShipmentFailure(rejected.status), true);
  assert.equal(classifyDhlShipmentHttpFailure(rejected.status, rejected.body).kind, "validation");

  const auth = simulateMyDhlCreateShipment(request, "authFailed");
  assert.equal(classifyDhlShipmentHttpFailure(auth.status, auth.body).kind, "authentication");

  const outage = simulateMyDhlCreateShipment(request, "outage");
  assert.equal(outage.status, 503);
  assert.equal(isDefinitiveShipmentFailure(outage.status), false);
});

test("simulated PDFs are well-formed with a correct cross-reference table", () => {
  const pdf = Buffer.from(buildSimulatedPdf("Shipping label (test)", ["Tracking: SIM-1", "To: Café \\ Road"]), "base64").toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.ok(pdf.includes("SIMULATED - NOT A DHL LABEL"));
  assert.ok(pdf.includes("Shipping label \\(test\\)"));

  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(startxref).startsWith("xref"));
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.ok(pdf.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));

  const stream = pdf.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(Number(stream[1]), Buffer.byteLength(stream[2], "latin1"));
});
