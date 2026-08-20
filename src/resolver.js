import { makeResolver } from "@forge/resolver";
import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const ACTIVITY_LOG_KEY = "dhl-activity-log";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";

const STANDARD_DHL_CATEGORIES = [
  { category: "pickedUp", label: "Picked Up", terminal: false },
  { category: "inTransit", label: "In Transit", terminal: false },
  { category: "outForDelivery", label: "Out for Delivery", terminal: false },
  { category: "awaitingCollection", label: "Awaiting Collection", terminal: false },
  { category: "onHold", label: "On Hold / Exception", terminal: false },
  { category: "customsDelay", label: "Customs / Clearance Delay", terminal: false },
  { category: "deliveryFailed", label: "Delivery Attempted / Failed", terminal: false },
  { category: "returnedToSender", label: "Returned to Sender", terminal: true },
  { category: "delivered", label: "Delivered", terminal: true },
  { category: "unknown", label: "Unknown / Other", terminal: false }
];

const DEFAULT_CONFIG = {
  enabled: true,
  projectKey: "SD",
  minDaysSinceSent: 0,
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
  comments: { enabled: true }
};

function categoryRows(savedRows = []) {
  return STANDARD_DHL_CATEGORIES.map((standard) => {
    const existing = (savedRows || []).find((row) =>
      row?.category === standard.category ||
      String(row?.dhlText || "").trim().toLowerCase() === standard.label.toLowerCase()
    ) || {};
    return {
      category: standard.category,
      label: standard.label,
      jiraStatus: existing.jiraStatus || "",
      deliveryStatus: existing.deliveryStatus || "",
      enabled: existing.enabled !== false,
      terminal: existing.terminal ?? standard.terminal,
      commentTemplate: existing.commentTemplate || ""
    };
  });
}

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    additionalFieldMappings: Array.isArray(saved.additionalFieldMappings)
      ? saved.additionalFieldMappings.filter((row) => row?.dhlPath || row?.jiraFieldId)
      : [],
    statusMappings: categoryRows(saved.statusMappings),
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

function usefulPreviewFields(shipment) {
  const flat = flattenObject(shipment);
  const preferred = [
    "id",
    "service",
    "status.status",
    "status.statusCode",
    "status.description",
    "status.timestamp",
    "estimatedTimeOfDelivery",
    "estimatedDeliveryTimeFrame.estimatedFrom",
    "estimatedDeliveryTimeFrame.estimatedThrough",
    "origin.address.addressLocality",
    "origin.address.postalCode",
    "origin.address.countryCode",
    "destination.address.addressLocality",
    "destination.address.postalCode",
    "destination.address.countryCode",
    "events.0.timestamp",
    "events.0.statusCode",
    "events.0.status",
    "events.0.description",
    "events.0.location.address.addressLocality"
  ];

  return preferred
    .filter((path) => flat[path] !== undefined)
    .map((path) => ({ path, value: flat[path] }));
}

export const handler = makeResolver({
  async getSettings() {
    return {
      config: await getConfig(),
      hasApiKey: Boolean(await kvs.getSecret(DHL_API_KEY_SECRET)),
      standardCategories: STANDARD_DHL_CATEGORIES
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
      (row) => row && row.jiraFieldId && row.dhlPath
    );
    config.statusMappings = categoryRows(config.statusMappings);

    await kvs.set(CONFIG_KEY, config);

    const apiKey = payload?.dhlApiKey?.trim();
    if (apiKey) await kvs.setSecret(DHL_API_KEY_SECRET, apiKey);

    const log = (await kvs.get(ACTIVITY_LOG_KEY)) || [];
    log.unshift({
      timestamp: new Date().toISOString(),
      level: "info",
      action: "Settings saved",
      details: "DHL/Jira mappings were updated by an administrator."
    });
    await kvs.set(ACTIVITY_LOG_KEY, log.slice(0, 250));

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
      for (const item of data?.values || []) {
        options.push({ id: item.id, value: item.value, contextId: context.id });
      }
    }

    const seen = new Set();
    return options.filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
  },

  async inspectDhlTracking({ payload }) {
    const trackingNumber = String(payload?.trackingNumber || "").trim();
    if (!trackingNumber) throw new Error("Enter a tracking number to inspect.");

    const config = await getConfig();
    const shipment = await fetchDhlShipment(config, trackingNumber);
    if (!shipment) {
      return { ok: true, shipmentFound: false, fields: [] };
    }

    return {
      ok: true,
      shipmentFound: true,
      description:
        shipment?.status?.description || shipment?.events?.[0]?.description || "DHL shipment found.",
      fields: usefulPreviewFields(shipment)
    };
  },

  async testDhlConnection({ payload }) {
    const trackingNumber = String(payload?.trackingNumber || "").trim();
    if (!trackingNumber) throw new Error("Enter a tracking number to test.");

    const config = await getConfig();
    const shipment = await fetchDhlShipment(config, trackingNumber);
    return {
      ok: true,
      shipmentFound: Boolean(shipment),
      description:
        shipment?.status?.description || shipment?.events?.[0]?.description ||
        "DHL API connection successful."
    };
  },

  async getActivityLog() {
    return (await kvs.get(ACTIVITY_LOG_KEY)) || [];
  },

  async clearActivityLog() {
    await kvs.set(ACTIVITY_LOG_KEY, []);
    return { ok: true };
  }
});
