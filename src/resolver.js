import { makeResolver } from "@forge/resolver";
import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const OBSERVED_STATUS_KEY = "dhl-observed-statuses";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";

const STANDARD_DHL_STATUSES = [
  { key: "delivered", description: "Delivered", terminal: true },
  { key: "returned", description: "Returned to Sender", terminal: true },
  { key: "deliveryFailed", description: "Delivery Failed / Attempted", terminal: false },
  { key: "awaitingCollection", description: "Awaiting Collection", terminal: false },
  { key: "onHold", description: "On Hold / Exception", terminal: false },
  { key: "customsDelay", description: "Customs / Clearance Delay", terminal: false },
  { key: "outForDelivery", description: "Out for Delivery", terminal: false },
  { key: "inTransit", description: "In Transit", terminal: false },
  { key: "pickedUp", description: "Picked Up", terminal: false },
  { key: "unknown", description: "Unknown / Other", terminal: false }
];

const DEFAULT_CONFIG = {
  enabled: true,
  projectKey: "SD",
  minDaysSinceSent: 3,
  maxPerRun: 3,
  dhlBaseUrl: DHL_DEFAULT_URL,
  fields: {
    tracking: "",
    deliveryStatus: "",
    deliveryDate: "",
    signedFor: "",
    dateSent: "",
    lastDhlCheck: "",
    client: ""
  },
  clients: [],
  additionalFieldMappings: [],
  statusMappings: [],
  legacyFallbackEnabled: true,
  workflowStatuses: {},
  deliveryStatusValues: {},
  comments: { enabled: true }
};

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function classifyDhlText(description = "", code = "", status = "") {
  const text = normalise(`${description} ${code} ${status}`);
  const has = (...phrases) => phrases.some((phrase) => text.includes(phrase));

  if (has("delivered")) return "delivered";
  if (has("returned to sender", "return to sender", "returned to shipper", "returned", "rt")) return "returned";
  if (has("delivery attempted", "delivery attempt", "attempted but no response", "consignee not available", "recipient not home", "delivery failed", "failure")) return "deliveryFailed";
  if (has("awaiting collection", "collection by the consignee", "ready for collection", "cc")) return "awaitingCollection";
  if (has("customs", "clearance", "clearance event")) return "customsDelay";
  if (has("on hold", "shipment is on hold", "exception", "further consignee information needed", "oh")) return "onHold";
  if (has("out for delivery", "out with courier", "courier for delivery", "scheduled for delivery", "wc")) return "outForDelivery";
  if (has("picked up", "shipment picked up", "pu")) return "pickedUp";
  if (has("transit", "processed", "departed", "arrived at", "facility", "forwarded", "sort facility")) return "inTransit";
  return "unknown";
}

function standardStatus(categoryKey) {
  return STANDARD_DHL_STATUSES.find((item) => item.key === categoryKey) || STANDARD_DHL_STATUSES[STANDARD_DHL_STATUSES.length - 1];
}

function standardiseObservedStatuses(items = []) {
  const seen = new Map();
  for (const item of items) {
    const categoryKey = classifyDhlText(item?.description, item?.code, item?.status);
    const standard = standardStatus(categoryKey);
    if (!seen.has(categoryKey)) {
      seen.set(categoryKey, {
        key: categoryKey,
        code: categoryKey,
        description: standard.description,
        status: categoryKey,
        terminal: standard.terminal,
        examples: []
      });
    }
    const current = seen.get(categoryKey);
    const example = String(item?.description || "").trim();
    if (example && !current.examples.includes(example) && current.examples.length < 5) {
      current.examples.push(example);
    }
  }
  return STANDARD_DHL_STATUSES
    .filter((standard) => seen.has(standard.key))
    .map((standard) => seen.get(standard.key));
}

function standardiseStatusMappings(rows = []) {
  const byCategory = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const categoryKey = row.categoryKey || classifyDhlText(row.dhlText, row.dhlCode, "");
    const standard = standardStatus(categoryKey);
    const existing = byCategory.get(categoryKey);
    const next = {
      ...row,
      categoryKey,
      dhlText: standard.description,
      dhlCode: categoryKey,
      terminal: row.terminal ?? standard.terminal
    };
    if (!existing) {
      byCategory.set(categoryKey, next);
    } else {
      byCategory.set(categoryKey, {
        ...existing,
        jiraStatus: existing.jiraStatus || next.jiraStatus || "",
        deliveryStatus: existing.deliveryStatus || next.deliveryStatus || "",
        commentTemplate: existing.commentTemplate || next.commentTemplate || "",
        terminal: Boolean(existing.terminal || next.terminal),
        enabled: existing.enabled !== false || next.enabled !== false
      });
    }
  }
  return STANDARD_DHL_STATUSES
    .filter((standard) => byCategory.has(standard.key))
    .map((standard) => byCategory.get(standard.key));
}

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    additionalFieldMappings: Array.isArray(saved.additionalFieldMappings)
      ? saved.additionalFieldMappings
      : [],
    statusMappings: standardiseStatusMappings(saved.statusMappings || []),
    workflowStatuses: { ...(saved.workflowStatuses || {}) },
    deliveryStatusValues: { ...(saved.deliveryStatusValues || {}) },
    comments: { ...DEFAULT_CONFIG.comments, ...(saved.comments || {}) }
  };
}

async function getConfig() {
  return mergeConfig((await kvs.get(CONFIG_KEY)) || {});
}

function flattenObject(value, prefix = "", out = {}) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.slice(0, 10).forEach((item, index) => {
      flattenObject(item, prefix ? `${prefix}.${index}` : String(index), out);
    });
    return out;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      flattenObject(child, prefix ? `${prefix}.${key}` : key, out);
    });
    return out;
  }
  out[prefix] = String(value);
  return out;
}

function extractObservedStatuses(shipment) {
  const found = [];
  const add = (description, code = "", status = "") => {
    const text = String(description || "").trim();
    if (!text) return;
    found.push({
      key: `${String(code || "").trim()}|${text.toLowerCase()}`,
      code: String(code || "").trim(),
      description: text,
      status: String(status || "").trim()
    });
  };

  add(shipment?.status?.description, shipment?.status?.statusCode, shipment?.status?.status);
  for (const event of shipment?.events || []) {
    add(event?.description, event?.statusCode || event?.code, event?.status);
  }
  return found;
}

async function mergeObservedStatuses(items) {
  const existing = (await kvs.get(OBSERVED_STATUS_KEY)) || [];
  const byKey = new Map(existing.map((item) => [item.key, item]));
  const now = new Date().toISOString();
  for (const item of items) {
    const previous = byKey.get(item.key) || {};
    byKey.set(item.key, {
      ...previous,
      ...item,
      firstSeen: previous.firstSeen || now,
      lastSeen: now
    });
  }
  const merged = [...byKey.values()]
    .sort((a, b) => a.description.localeCompare(b.description))
    .slice(0, 500);
  await kvs.set(OBSERVED_STATUS_KEY, merged);
  return merged;
}

async function fetchDhlShipment(config, trackingNumber) {
  const apiKey = await kvs.getSecret(DHL_API_KEY_SECRET);
  if (!apiKey) throw new Error("Save a DHL API key first.");

  const response = await api.fetch(
    `${config.dhlBaseUrl || DHL_DEFAULT_URL}?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    {
      method: "GET",
      headers: { "DHL-API-Key": apiKey, Accept: "application/json" }
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DHL returned HTTP ${response.status}: ${text.slice(0, 800)}`);
  }

  const data = JSON.parse(text);
  return data?.shipments?.[0] || null;
}

export const handler = makeResolver({
  async getSettings() {
    return {
      config: await getConfig(),
      hasApiKey: Boolean(await kvs.getSecret(DHL_API_KEY_SECRET))
    };
  },

  async saveSettings({ payload }) {
    const current = await getConfig();
    const incoming = payload?.config || {};
    const config = mergeConfig({ ...current, ...incoming });

    if (!config.projectKey?.trim()) throw new Error("Project key is required.");
    if (!config.fields?.tracking) throw new Error("Select a Jira tracking number field.");

    config.minDaysSinceSent = Math.max(0, Number(config.minDaysSinceSent ?? 0));
    config.maxPerRun = Math.min(50, Math.max(1, Number(config.maxPerRun ?? 3)));
    config.additionalFieldMappings = (config.additionalFieldMappings || []).filter(
      (m) => m && m.jiraFieldId && m.dhlPath
    );
    config.statusMappings = standardiseStatusMappings(config.statusMappings || []);

    await kvs.set(CONFIG_KEY, config);

    const apiKey = payload?.dhlApiKey?.trim();
    if (apiKey) await kvs.setSecret(DHL_API_KEY_SECRET, apiKey);

    return {
      ok: true,
      hasApiKey: Boolean(apiKey || (await kvs.getSecret(DHL_API_KEY_SECRET)))
    };
  },

  async getJiraMetadata() {
    const [fieldsRes, statusesRes] = await Promise.all([
      api.asApp().requestJira(route`/rest/api/3/field`, {
        headers: { Accept: "application/json" }
      }),
      api.asApp().requestJira(route`/rest/api/3/status`, {
        headers: { Accept: "application/json" }
      })
    ]);

    if (!fieldsRes.ok) throw new Error(`Could not read Jira fields: ${await fieldsRes.text()}`);
    if (!statusesRes.ok) throw new Error(`Could not read Jira statuses: ${await statusesRes.text()}`);

    const fields = await fieldsRes.json();
    const statuses = await statusesRes.json();

    return {
      fields: fields
        .map((field) => ({
          id: field.id,
          name: field.name,
          custom: Boolean(field.custom),
          schemaType: field.schema?.type || "",
          customType: field.schema?.custom || ""
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      statuses: statuses
        .map((status) => ({ id: status.id, name: status.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  },

  async getFieldOptions({ payload }) {
    const fieldId = String(payload?.fieldId || "").trim();
    if (!fieldId?.startsWith("customfield_")) return [];

    const contextsRes = await api.asApp().requestJira(
      route`/rest/api/3/field/${fieldId}/context?maxResults=100`,
      { headers: { Accept: "application/json" } }
    );
    if (!contextsRes.ok) return [];

    const contexts = (await contextsRes.json())?.values || [];
    const options = [];

    for (const context of contexts) {
      const optionsRes = await api.asApp().requestJira(
        route`/rest/api/3/field/${fieldId}/context/${context.id}/option?maxResults=1000`,
        { headers: { Accept: "application/json" } }
      );
      if (!optionsRes.ok) continue;
      const data = await optionsRes.json();
      for (const option of data?.values || []) {
        options.push({ id: option.id, value: option.value, contextId: context.id });
      }
    }

    const seen = new Set();
    return options.filter((option) => {
      const key = option.value;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async getObservedDhlStatuses() {
    const raw = (await kvs.get(OBSERVED_STATUS_KEY)) || [];
    return standardiseObservedStatuses(raw);
  },

  async clearObservedDhlStatuses() {
    await kvs.set(OBSERVED_STATUS_KEY, []);
    return { ok: true };
  },

  async inspectDhlTracking({ payload }) {
    const trackingNumber = String(payload?.trackingNumber || "").trim();
    if (!trackingNumber) throw new Error("Enter a tracking number to inspect.");

    const config = await getConfig();
    const shipment = await fetchDhlShipment(config, trackingNumber);
    if (!shipment) {
      return { ok: true, shipmentFound: false, fields: [], statuses: [] };
    }

    const rawObserved = await mergeObservedStatuses(extractObservedStatuses(shipment));
    const flattened = flattenObject(shipment);

    return {
      ok: true,
      shipmentFound: true,
      description:
        shipment?.status?.description || shipment?.events?.[0]?.description || "DHL shipment found.",
      fields: Object.entries(flattened)
        .map(([path, value]) => ({ path, value }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      statuses: standardiseObservedStatuses(rawObserved)
    };
  },

  async testDhlConnection({ payload }) {
    const trackingNumber = String(payload?.trackingNumber || "").trim();
    if (!trackingNumber) throw new Error("Enter a tracking number to test.");

    const config = await getConfig();
    const shipment = await fetchDhlShipment(config, trackingNumber);
    if (!shipment) return { ok: true, shipmentFound: false, description: "Connection successful, but no shipment was returned." };

    await mergeObservedStatuses(extractObservedStatuses(shipment));
    return {
      ok: true,
      shipmentFound: true,
      description:
        shipment?.status?.description || shipment?.events?.[0]?.description || "DHL API connection successful."
    };
  }
});
