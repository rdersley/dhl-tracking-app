import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PACKAGE_PRESETS,
  applyPackagePreset,
  buildMyDhlShipmentPayload,
  cleanDefaultPackagePreset,
  cleanPackagePresets,
} from "../src/shipment-core.mjs";

test("valid presets are kept with numbers and a stable id", () => {
  const presets = cleanPackagePresets([
    { name: " Laptop box ", weightKg: "3.5", lengthCm: "45", widthCm: "35", heightCm: "12", description: "Replacement laptop" },
  ]);
  assert.deepEqual(presets, [{
    id: "laptop-box",
    name: "Laptop box",
    weightKg: 3.5,
    lengthCm: 45,
    widthCm: 35,
    heightCm: 12,
    description: "Replacement laptop",
  }]);
  assert.equal(cleanPackagePresets(presets)[0].id, "laptop-box", "saved ids are kept on re-save");
});

test("presets without a name, with non-positive sizes or duplicate names are dropped", () => {
  const presets = cleanPackagePresets([
    { name: "", weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 },
    { name: "Zero weight", weightKg: 0, lengthCm: 10, widthCm: 10, heightCm: 10 },
    { name: "Bad height", weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: "abc" },
    { name: "Terminal", weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 },
    { name: "terminal", weightKg: 2, lengthCm: 20, widthCm: 15, heightCm: 10 },
  ]);
  assert.deepEqual(presets.map((preset) => preset.name), ["Terminal"]);
  assert.deepEqual(cleanPackagePresets("not a list"), []);
});

test("ids are unique even when names slug to the same value", () => {
  const presets = cleanPackagePresets([
    { name: "Box (small)", weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 },
    { name: "Box small", weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 },
    { name: "Third", id: "box-small", weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 },
  ]);
  const ids = presets.map((preset) => preset.id);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids.slice(0, 2), ["box-small", "box-small-2"]);
});

test("the preset list is capped", () => {
  const many = Array.from({ length: MAX_PACKAGE_PRESETS + 5 }, (_, index) => ({ name: `Box ${index}`, weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 }));
  assert.equal(cleanPackagePresets(many).length, MAX_PACKAGE_PRESETS);
});

test("the default preset must exist", () => {
  const presets = cleanPackagePresets([{ name: "Laptop box", weightKg: 3, lengthCm: 45, widthCm: 35, heightCm: 12 }]);
  assert.equal(cleanDefaultPackagePreset("laptop-box", presets), "laptop-box");
  assert.equal(cleanDefaultPackagePreset("removed-preset", presets), "");
  assert.equal(cleanDefaultPackagePreset(undefined, presets), "");
});

test("applying a preset fills the form's package fields and produces a valid DHL package", () => {
  const [preset] = cleanPackagePresets([{ name: "Laptop box", weightKg: 3.5, lengthCm: 45, widthCm: 35, heightCm: 12, description: "Laptop" }]);
  const pkg = applyPackagePreset({ weightKg: "1", lengthCm: "30", widthCm: "20", heightCm: "10", description: "Hardware" }, preset);
  assert.deepEqual(pkg, { weightKg: "3.5", lengthCm: "45", widthCm: "35", heightCm: "12", description: "Laptop" });
  assert.equal(applyPackagePreset({ description: "Hardware" }, { ...preset, description: "" }).description, "Hardware");
  assert.deepEqual(applyPackagePreset({ weightKg: "1" }, null), { weightKg: "1" });

  const draft = {
    reference: "HW-1",
    shipper: { name: "W", address1: "1", city: "Dublin", postalCode: "D01", countryCode: "IE" },
    receiver: { name: "R", address1: "2", city: "Cork", postalCode: "T12", countryCode: "IE" },
    package: pkg,
  };
  const payload = buildMyDhlShipmentPayload(draft, { dhlShippingAccountNumber: "1", dhlProductCode: "N" });
  assert.equal(payload.content.packages[0].weight, 3.5);
  assert.deepEqual(payload.content.packages[0].dimensions, { length: 45, width: 35, height: 12 });
});
