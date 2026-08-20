import { makeResolver } from "@forge/resolver";
import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";

const DEFAULT_CONFIG = {
  enabled: true,
  projectKey: "SD",
  minDaysSinceSent: 3,
  maxPerRun: 3,
  dhlBaseUrl: DHL_DEFAULT_URL,
  fields: {
    tracking: "customfield_10417",
    deliveryStatus: "customfield_11952",
    deliveryDate: "customfield_10434",
    signedFor: "customfield_10442",
    dateSent: "customfield_10433",
    lastDhlCheck: "customfield_14400",
    client: "customfield_11658"
  },
  clients: ["RYR - Ryanair", "RYS - Buzz", "LDA - Lauda "],
  workflowStatuses: {
    dispatched: "Dispatched to Customer",
    outForDelivery: "OUT FOR DELIVERY",
    awaitingCollection: "DELIVERY AWAITING COLLECTION",
    onHold: "DELIVERY ON HOLD",
    failed: "DELIVERY FAILED",
    resolved: "Resolved"
  },
  deliveryStatusValues: {
    delivered: "Delivered",
    returnedToSender: "Returned to Sender",
    deliveryFailed: "Delivery Attempted",
    awaitingCollection: "Awaiting Collection",
    onHold: "Exception / On Hold",
    customsDelay: "Customs Delay",
    outForDelivery: "Out for Delivery",
    inTransit: "In Transit",
    unknown: "Unknown"
  },
  comments: {
    enabled: true,
    outForDelivery: "📦 DHL update for {issueKey}: shipment {trackingNumber} is out for delivery.\n\nLatest DHL update: {dhlDescription}",
    awaitingCollection: "📦 DHL update for {issueKey}: shipment {trackingNumber} is awaiting collection.\n\nLatest DHL update: {dhlDescription}",
    onHold: "⚠️ DHL update for {issueKey}: shipment {trackingNumber} is on hold.\n\nLatest DHL update: {dhlDescription}",
    failed: "⚠️ DHL update for {issueKey}: delivery requires attention.\n\nLatest DHL update: {dhlDescription}",
    delivered: "📦 DHL Delivery Update (Automated)\n\nDelivered: {date}\nSigned for by: {signedFor}\nTracking number: {trackingNumber}"
  }
};

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    workflowStatuses: {
      ...DEFAULT_CONFIG.workflowStatuses,
      ...(saved.workflowStatuses || {})
    },
    deliveryStatusValues: {
      ...DEFAULT_CONFIG.deliveryStatusValues,
      ...(saved.deliveryStatusValues || {})
    },
    comments: {
      ...DEFAULT_CONFIG.comments,
      ...(saved.comments || {})
    }
  };
}

async function getConfig() {
  const saved = await kvs.get(CONFIG_KEY);
  return mergeConfig(saved || {});
}

export const handler = makeResolver({
  async getSettings() {
    const config = await getConfig();
    const secret = await kvs.getSecret(DHL_API_KEY_SECRET);

    return {
      config,
      hasApiKey: Boolean(secret)
    };
  },

  async saveSettings({ payload }) {
    const incoming = payload?.config || {};
    const current = await getConfig();
    const config = mergeConfig({ ...current, ...incoming });

    if (!config.projectKey?.trim()) {
      throw new Error("Project key is required.");
    }

    config.minDaysSinceSent = Math.max(
      0,
      Number(config.minDaysSinceSent ?? 0)
    );

    config.maxPerRun = Math.min(
      50,
      Math.max(1, Number(config.maxPerRun ?? 3))
    );

    await kvs.set(CONFIG_KEY, config);

    const apiKey = payload?.dhlApiKey?.trim();
    if (apiKey) {
      await kvs.setSecret(DHL_API_KEY_SECRET, apiKey);
    }

    return {
      ok: true,
      hasApiKey: Boolean(
        apiKey || (await kvs.getSecret(DHL_API_KEY_SECRET))
      )
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

    if (!fieldsRes.ok) {
      throw new Error(
        `Could not read Jira fields: ${await fieldsRes.text()}`
      );
    }

    if (!statusesRes.ok) {
      throw new Error(
        `Could not read Jira statuses: ${await statusesRes.text()}`
      );
    }

    const fields = await fieldsRes.json();
    const statuses = await statusesRes.json();

    return {
      fields: fields
        .map((field) => ({
          id: field.id,
          name: field.name,
          custom: Boolean(field.custom)
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),

      statuses: statuses
        .map((status) => ({
          id: status.id,
          name: status.name
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  },

  async testDhlConnection({ payload }) {
    const trackingNumber = String(
      payload?.trackingNumber || ""
    ).trim();

    if (!trackingNumber) {
      throw new Error("Enter a tracking number to test.");
    }

    const config = await getConfig();
    const apiKey = await kvs.getSecret(DHL_API_KEY_SECRET);

    if (!apiKey) {
      throw new Error("Save a DHL API key first.");
    }

    const url =
      `${config.dhlBaseUrl || DHL_DEFAULT_URL}` +
      `?trackingNumber=${encodeURIComponent(trackingNumber)}`;

    const response = await api.fetch(url, {
      method: "GET",
      headers: {
        "DHL-API-Key": apiKey,
        Accept: "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: text.slice(0, 800)
      };
    }

    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}

    const shipment = data?.shipments?.[0];

    return {
      ok: true,
      status: response.status,
      shipmentFound: Boolean(shipment),
      description:
        shipment?.status?.description ||
        shipment?.events?.[0]?.description ||
        "DHL API connection successful."
    };
  }
});
