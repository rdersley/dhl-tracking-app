// Prefills the Create DHL Shipment receiver from the SD ticket linked to the
// hardware ticket. An admin maps each receiver line to a Jira field in
// Delivery Manager settings; nothing is assumed about which fields a site
// uses for addresses.

export const RECEIVER_PARTS = [
  { key: "name", label: "Receiver name" },
  { key: "company", label: "Company" },
  { key: "address1", label: "Address line 1" },
  { key: "address2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "county", label: "County / region" },
  { key: "postalCode", label: "Postal code" },
  { key: "countryCode", label: "Country" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
];

// Pseudo-fields that read the SD ticket's reporter instead of a field.
export const REPORTER_NAME = "reporter";
export const REPORTER_EMAIL = "reporterEmail";

const FIELD_ID = /^[A-Za-z0-9_.-]{1,60}$/;

export function cleanReceiverFieldMap(value) {
  const map = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const { key } of RECEIVER_PARTS) {
    const fieldId = String(value[key] ?? "").trim();
    if (fieldId && FIELD_ID.test(fieldId)) map[key] = fieldId;
  }
  return map;
}

// Jira field ids that must be requested to resolve the map ("reporter" covers
// both pseudo-fields).
export function receiverSourceFields(map = {}) {
  const ids = new Set();
  for (const fieldId of Object.values(cleanReceiverFieldMap(map))) {
    ids.add(fieldId === REPORTER_EMAIL ? "reporter" : fieldId);
  }
  return [...ids];
}

// Plain text from an Atlassian Document Format value (multi-line text fields).
function adfText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(adfText).join("");
  return ["paragraph", "heading", "listItem"].includes(node.type) ? `${inner}\n` : inner;
}

// Turns any common Jira field value into one line of text: strings, numbers,
// select options (including cascading), users, arrays and ADF documents.
export function fieldValueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(fieldValueText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.type === "doc") return adfText(value);
    if (value.value !== undefined) {
      const child = value.child ? fieldValueText(value.child) : "";
      return [String(value.value), child].filter(Boolean).join(" - ");
    }
    if (value.displayName !== undefined) return String(value.displayName);
    if (value.name !== undefined) return String(value.name);
  }
  return "";
}

function oneLine(text, max) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s{2,}/g, " ")
    .slice(0, max);
}

// Common names for the countries this team ships to most. Anything else that
// is not already a two-letter code is left for the agent to correct; the
// form's validation flags it before anything is sent to DHL.
const COUNTRY_NAMES = {
  ireland: "IE", "republic of ireland": "IE", eire: "IE",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  austria: "AT", belgium: "BE", bulgaria: "BG", croatia: "HR", cyprus: "CY", czechia: "CZ", "czech republic": "CZ",
  denmark: "DK", estonia: "EE", finland: "FI", france: "FR", germany: "DE", greece: "GR", hungary: "HU", italy: "IT",
  latvia: "LV", lithuania: "LT", luxembourg: "LU", malta: "MT", netherlands: "NL", "the netherlands": "NL", holland: "NL",
  poland: "PL", portugal: "PT", romania: "RO", slovakia: "SK", slovenia: "SI", spain: "ES", sweden: "SE",
  norway: "NO", switzerland: "CH", iceland: "IS", morocco: "MA", israel: "IL", jordan: "JO", turkey: "TR", "united states": "US", usa: "US",
};

export function normaliseCountryInput(text) {
  const value = oneLine(text, 60);
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return COUNTRY_NAMES[value.toLowerCase()] || value;
}

const PART_LIMITS = { name: 100, company: 100, address1: 200, address2: 200, city: 100, county: 100, postalCode: 20, phone: 40, email: 200 };

function partValue(issue, fieldId, part) {
  if (!issue?.fields) return "";
  if (fieldId === REPORTER_NAME) return oneLine(issue.fields.reporter?.displayName, PART_LIMITS[part] || 200);
  if (fieldId === REPORTER_EMAIL) return oneLine(issue.fields.reporter?.emailAddress, PART_LIMITS[part] || 200);
  const text = fieldValueText(issue.fields[fieldId]);
  return part === "countryCode" ? normaliseCountryInput(text) : oneLine(text, PART_LIMITS[part] || 200);
}

// Reads each mapped field from the linked SD ticket, falling back to the same
// field on the hardware ticket (for sites that copy SD fields across).
export function buildReceiverPrefill(sdIssue, hwIssue, map = {}) {
  const clean = cleanReceiverFieldMap(map);
  const receiver = {};
  const filled = [];
  for (const { key } of RECEIVER_PARTS) {
    const fieldId = clean[key];
    if (!fieldId) continue;
    const value = partValue(sdIssue, fieldId, key) || partValue(hwIssue, fieldId, key);
    if (value) {
      receiver[key] = value;
      filled.push(key);
    }
  }
  return { receiver, filled };
}

// Applies prefilled values to the form's receiver, replacing only the form's
// untouched defaults so nothing an agent has typed is overwritten.
export function mergeReceiverPrefill(current = {}, prefill = {}, defaults = {}) {
  const next = { ...current };
  for (const [key, value] of Object.entries(prefill || {})) {
    const existing = String(current[key] ?? "");
    if (!existing || existing === String(defaults[key] ?? "")) next[key] = value;
  }
  return next;
}
