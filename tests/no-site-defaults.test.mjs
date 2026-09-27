import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Delivery Manager is sold to many Jira sites, so shipped code must not carry
// one customer's custom field IDs, project keys or client names as defaults.
// Every site-specific value has to come from the admin settings page.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(m?js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

test("source code contains no hard-coded custom field IDs or customer names", () => {
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /customfield_\d+/, `${file} hard-codes a custom field ID`);
    assert.doesNotMatch(text, /Ryanair|Lauda|RYR -|RYS -|LDA -/i, `${file} hard-codes a customer name`);
  }
});

test("default configuration leaves projects, statuses and fields empty", () => {
  for (const file of ["src/config.js", "src/frontend/settings.jsx"]) {
    const text = readFileSync(file, "utf8");
    for (const key of ["sdProject", "hwProject", "sdSentStatus", "hwDispatchedStatus", "sdDispatchedStatus", "trackingField", "dateSentField", "deliveryStatusField", "lastDhlCheckField"]) {
      assert.match(text, new RegExp(`^\\s*${key}: "",`, "m"), `${file} should default ${key} to ""`);
    }
  }
});
