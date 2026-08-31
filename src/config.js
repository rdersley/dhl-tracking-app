import { storage } from "@forge/api";

export const CONFIG_KEY = "delivery-manager-config-v1";

export const DEFAULT_CONFIG = {
  sdProject: "SD",
  hwProject: "HW",
  sdSentStatus: "Sent to Hardware",
  hwDispatchedStatus: "Dispatched",
  sdDispatchedStatus: "Dispatched",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  deliveryStatusField: "customfield_11952",
  deliveryDateField: "customfield_10434",
  signedForField: "customfield_10442",
  lastDhlCheckField: "customfield_14400",
  deliveryStatusJql: "Delivery Status[Dropdown]",
  resolvedStatus: "Resolved",
  hwIssueType: "",
  hwLinkType: "Relates",
  createEnabled: false,
  commentsEnabled: true,
  transitionsEnabled: true,
  maxResults: 100,
  clientRestrictionEnabled: false,
  clientValues: [],
};

export async function getDeliveryManagerConfig() {
  const saved = (await storage.get(CONFIG_KEY)) || {};
  return { ...DEFAULT_CONFIG, ...saved, createEnabled: saved.createEnabled === true };
}

export async function saveDeliveryManagerConfig(config) {
  const clean = {
    ...DEFAULT_CONFIG,
    ...config,
    createEnabled: config?.createEnabled === true,
    commentsEnabled: config?.commentsEnabled !== false,
    transitionsEnabled: config?.transitionsEnabled !== false,
    clientRestrictionEnabled: config?.clientRestrictionEnabled === true,
    clientValues: Array.isArray(config?.clientValues) ? config.clientValues.filter(Boolean) : [],
    maxResults: Math.max(1, Math.min(100, Number(config?.maxResults || 100))),
  };
  await storage.set(CONFIG_KEY, clean);
  return clean;
}
