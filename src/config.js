import { kvs } from "@forge/kvs";

export const CONFIG_KEY = "delivery-manager-config-v1";
export const DHL_API_KEY_SECRET = "delivery-manager-dhl-api-key";

export const DEFAULT_CONFIG = {
  sdProject: "SD",
  hwProject: "HW",
  sdSentStatus: "Sent to Hardware",
  hwDispatchedStatus: "Dispatched",
  sdDispatchedStatus: "Dispatched",
  resolvedStatus: "Resolved",
  resolutionName: "Done",
  outForDeliveryStatus: "OUT FOR DELIVERY",
  awaitingCollectionStatus: "DELIVERY AWAITING COLLECTION",
  onHoldStatus: "DELIVERY ON HOLD",
  failedStatus: "DELIVERY FAILED",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  deliveryStatusField: "customfield_11952",
  deliveryDateField: "customfield_10434",
  signedForField: "customfield_10442",
  lastDhlCheckField: "customfield_14400",
  clientField: "",
  clientRestrictionEnabled: false,
  clientValues: [],
  hwIssueType: "",
  hwLinkType: "Relates",
  hwFieldMappings: [],
  createEnabled: false,
  commentsEnabled: true,
  transitionsEnabled: true,
  maxResults: 100,
  dhlBatchSize: 10,
  dhlDelayMs: 3000,
  minDaysSinceSent: 3,
  dhlApiUrl: "https://api-eu.dhl.com/track/shipments",
  dhlAccountNumber: "",
  deliveredValue: "Delivered",
  inTransitValue: "In Transit",
  outForDeliveryValue: "Out for Delivery",
  awaitingCollectionValue: "Awaiting Collection",
  onHoldValue: "On Hold",
  failedValue: "Delivery Failed",
};

function cleanMappings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const mappings = [];
  for (const item of value) {
    const source = String(item?.source || "").trim();
    const target = String(item?.target || "").trim();
    if (!source || !target || seen.has(target)) continue;
    seen.add(target);
    mappings.push({ source, target });
  }
  return mappings.slice(0, 50);
}

function cleanDhlUrl(value) {
  const fallback = DEFAULT_CONFIG.dhlApiUrl;
  const text = String(value || fallback).trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api-eu.dhl.com") return fallback;
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function cleanText(value, fallback = "", max = 200) {
  const text = String(value ?? fallback).trim();
  return text.slice(0, max);
}

export async function getDeliveryManagerConfig() {
  const saved = (await kvs.get(CONFIG_KEY)) || {};
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    createEnabled: saved.createEnabled === true,
    commentsEnabled: saved.commentsEnabled !== false,
    transitionsEnabled: saved.transitionsEnabled !== false,
    clientRestrictionEnabled: saved.clientRestrictionEnabled === true,
    hwFieldMappings: cleanMappings(saved.hwFieldMappings),
    dhlApiUrl: cleanDhlUrl(saved.dhlApiUrl),
    dhlAccountNumber: cleanText(saved.dhlAccountNumber),
    resolutionName: cleanText(saved.resolutionName, DEFAULT_CONFIG.resolutionName, 100),
  };
}

export async function saveDeliveryManagerConfig(config) {
  const clean = {
    ...DEFAULT_CONFIG,
    ...config,
    createEnabled: config?.createEnabled === true,
    commentsEnabled: config?.commentsEnabled !== false,
    transitionsEnabled: config?.transitionsEnabled !== false,
    clientRestrictionEnabled: config?.clientRestrictionEnabled === true,
    clientValues: Array.isArray(config?.clientValues) ? config.clientValues.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100) : [],
    hwFieldMappings: cleanMappings(config?.hwFieldMappings),
    maxResults: Math.max(1, Math.min(100, Number(config?.maxResults || 100))),
    dhlBatchSize: Math.max(1, Math.min(50, Number(config?.dhlBatchSize || 10))),
    dhlDelayMs: Math.max(1000, Math.min(15000, Number(config?.dhlDelayMs || 3000))),
    minDaysSinceSent: Math.max(0, Math.min(30, Number(config?.minDaysSinceSent ?? 3))),
    dhlApiUrl: cleanDhlUrl(config?.dhlApiUrl),
    dhlAccountNumber: cleanText(config?.dhlAccountNumber, "", 100),
    resolutionName: cleanText(config?.resolutionName, DEFAULT_CONFIG.resolutionName, 100),
    deliveredValue: cleanText(config?.deliveredValue, DEFAULT_CONFIG.deliveredValue, 100),
    inTransitValue: cleanText(config?.inTransitValue, DEFAULT_CONFIG.inTransitValue, 100),
    outForDeliveryValue: cleanText(config?.outForDeliveryValue, DEFAULT_CONFIG.outForDeliveryValue, 100),
    awaitingCollectionValue: cleanText(config?.awaitingCollectionValue, DEFAULT_CONFIG.awaitingCollectionValue, 100),
    onHoldValue: cleanText(config?.onHoldValue, DEFAULT_CONFIG.onHoldValue, 100),
    failedValue: cleanText(config?.failedValue, DEFAULT_CONFIG.failedValue, 100),
  };
  delete clean.dhlApiKey;
  delete clean.dhlApiKeyConfigured;
  await kvs.set(CONFIG_KEY, clean);
  return clean;
}

export async function getDhlApiKey() {
  return (await kvs.getSecret(DHL_API_KEY_SECRET)) || "";
}

export async function hasDhlApiKey() {
  return Boolean(await getDhlApiKey());
}

export async function setDhlApiKey(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  await kvs.setSecret(DHL_API_KEY_SECRET, key);
  return true;
}

export async function clearDhlApiKey() {
  try {
    await kvs.deleteSecret(DHL_API_KEY_SECRET);
  } catch {
    // It is safe to treat a missing secret as already cleared.
  }
}
