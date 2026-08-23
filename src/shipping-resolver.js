import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import Resolver from "@forge/resolver";

const resolver = new Resolver();
const CONFIG_KEY = "dhl-shipping-config";
const USER_SECRET = "mydhl-api-username";
const PASS_SECRET = "mydhl-api-password";
const ACTIVITY_LOG_KEY = "dhl-activity-log";
const TEST_BASE = "https://express.api.dhl.com/mydhlapi/test";
const PROD_BASE = "https://express.api.dhl.com/mydhlapi";

const DEFAULT_CONFIG = {
  enabled: false,
  environment: "test",
  sourceProjects: [],
  accountNumber: "",
  productCode: "P",
  duplicateMode: "block",
  requestPickup: false,
  trackingFieldId: "",
  fieldMappings: {
    recipientCompany: "", recipientName: "", recipientPhone: "", recipientEmail: "",
    address1: "", address2: "", address3: "", city: "", province: "", provinceCode: "", postalCode: "", countryCode: "",
    shipmentDate: "", packageCount: "", weight: "", length: "", width: "", height: "", contents: "", reference: "",
    declaredValue: "", currency: "", incoterm: "", exportReason: ""
  },
  shipper: {
    company: "", name: "", phone: "", email: "", address1: "", address2: "", address3: "",
    city: "", province: "", provinceCode: "", postalCode: "", countryCode: ""
  },
  responseMappings: {
    shipmentId: "", productCode: "", createdAt: "", estimatedDelivery: "", statusSummary: ""
  }
};

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fieldMappings: { ...DEFAULT_CONFIG.fieldMappings, ...(saved.fieldMappings || {}) },
    shipper: { ...DEFAULT_CONFIG.shipper, ...(saved.shipper || {}) },
    responseMappings: { ...DEFAULT_CONFIG.responseMappings, ...(saved.responseMappings || {}) },
    sourceProjects: Array.isArray(saved.sourceProjects) ? saved.sourceProjects : []
  };
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value.value ?? value.name ?? value.displayName ?? value.emailAddress ?? "");
}

function fieldValue(issue, fieldId) {
  return fieldId ? scalar(issue?.fields?.[fieldId]) : "";
}

async function getConfig() {
  return mergeConfig((await kvs.get(CONFIG_KEY)) || {});
}

async function getCredentials() {
  const [username, password] = await Promise.all([kvs.getSecret(USER_SECRET), kvs.getSecret(PASS_SECRET)]);
  return { username, password };
}

async function logActivity(level, action, details, issueKey = "") {
  try {
    const existing = (await kvs.get(ACTIVITY_LOG_KEY)) || [];
    existing.unshift({ timestamp: new Date().toISOString(), level, action, details, issueKey });
    await kvs.set(ACTIVITY_LOG_KEY, existing.slice(0, 100));
  } catch (e) {
    console.log("Shipping activity log failure", String(e));
  }
}

async function readIssue(issueKey, config) {
  const fieldIds = [
    config.trackingFieldId,
    ...Object.values(config.fieldMappings || {}),
    ...Object.values(config.responseMappings || {}),
    "project", "summary"
  ].filter(Boolean);
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=${fieldIds.join(",")}`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error(`Could not read Jira issue: ${await response.text()}`);
  return response.json();
}

function buildPreview(issue, config) {
  const m = config.fieldMappings;
  const packageCount = Number(fieldValue(issue, m.packageCount) || 1);
  return {
    issueKey: issue.key,
    projectKey: issue.fields?.project?.key || "",
    summary: issue.fields?.summary || "",
    recipient: {
      company: fieldValue(issue, m.recipientCompany), name: fieldValue(issue, m.recipientName),
      phone: fieldValue(issue, m.recipientPhone), email: fieldValue(issue, m.recipientEmail),
      address1: fieldValue(issue, m.address1), address2: fieldValue(issue, m.address2), address3: fieldValue(issue, m.address3),
      city: fieldValue(issue, m.city), province: fieldValue(issue, m.province), provinceCode: fieldValue(issue, m.provinceCode),
      postalCode: fieldValue(issue, m.postalCode), countryCode: fieldValue(issue, m.countryCode).toUpperCase()
    },
    shipment: {
      shipmentDate: fieldValue(issue, m.shipmentDate), packageCount: Number.isFinite(packageCount) && packageCount > 0 ? packageCount : 1,
      weight: Number(fieldValue(issue, m.weight)), length: Number(fieldValue(issue, m.length)),
      width: Number(fieldValue(issue, m.width)), height: Number(fieldValue(issue, m.height)),
      contents: fieldValue(issue, m.contents), reference: fieldValue(issue, m.reference) || issue.key,
      declaredValue: Number(fieldValue(issue, m.declaredValue)), currency: fieldValue(issue, m.currency),
      incoterm: fieldValue(issue, m.incoterm), exportReason: fieldValue(issue, m.exportReason)
    },
    shipper: config.shipper,
    existingTracking: fieldValue(issue, config.trackingFieldId),
    environment: config.environment
  };
}

function validateLocal(preview, config) {
  const errors = [];
  if (!config.enabled) errors.push("Shipment creation is disabled by the administrator.");
  if (config.sourceProjects.length && !config.sourceProjects.includes(preview.projectKey)) errors.push(`Project ${preview.projectKey} is not enabled for DHL shipment creation.`);
  if (!config.accountNumber) errors.push("DHL Express account number is not configured.");
  if (!config.trackingFieldId) errors.push("Tracking / waybill Jira field is not configured.");
  if (preview.existingTracking && config.duplicateMode === "block") errors.push("This issue already has a tracking number. Shipment creation is blocked to prevent duplicates.");
  if (!preview.recipient.company && !preview.recipient.name) errors.push("Recipient company or contact name is required.");
  if (!preview.recipient.address1) errors.push("Recipient address line 1 is required.");
  if (!preview.recipient.city) errors.push("Recipient city is required.");
  if (!/^[A-Z]{2}$/.test(preview.recipient.countryCode)) errors.push("Recipient country code must be a 2-letter ISO code.");
  if (!(preview.shipment.weight > 0)) errors.push("Package weight must be greater than zero.");
  if (!preview.shipment.contents) errors.push("Shipment contents / description is required.");
  for (const [key, value] of Object.entries({ company: config.shipper.company, name: config.shipper.name, phone: config.shipper.phone, address1: config.shipper.address1, city: config.shipper.city, countryCode: config.shipper.countryCode })) {
    if (!value && ["phone"].includes(key) === false) errors.push(`Shipper ${key} is required.`);
  }
  return errors;
}

async function dhlFetch(config, path, options = {}) {
  const { username, password } = await getCredentials();
  if (!username || !password) throw new Error("MyDHL API username/password are not configured.");
  const base = config.environment === "production" ? PROD_BASE : TEST_BASE;
  const response = await api.fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuth(username, password), Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const safe = body?.detail || body?.title || body?.message || `DHL returned HTTP ${response.status}`;
    const error = new Error(String(safe).slice(0, 800));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function validateAddressWithDhl(config, preview) {
  const r = preview.recipient;
  const qs = new URLSearchParams({ type: "delivery", countryCode: r.countryCode, cityName: r.city, strictValidation: "true" });
  if (r.postalCode) qs.set("postalCode", r.postalCode);
  return dhlFetch(config, `/address-validate?${qs.toString()}`, { method: "GET" });
}

function contact(info) {
  return {
    email: info.email || undefined,
    phone: info.phone || undefined,
    companyName: info.company || undefined,
    fullName: info.name || info.company || undefined
  };
}

function postal(info) {
  return {
    postalCode: info.postalCode || undefined,
    cityName: info.city,
    countryCode: String(info.countryCode || "").toUpperCase(),
    provinceName: info.province || undefined,
    provinceCode: info.provinceCode || undefined,
    addressLine1: info.address1,
    addressLine2: info.address2 || undefined,
    addressLine3: info.address3 || undefined
  };
}

function buildShipmentRequest(config, preview) {
  const s = preview.shipment;
  const planned = s.shipmentDate
    ? `${s.shipmentDate}T12:00:00 GMT+00:00`
    : `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T12:00:00 GMT+00:00`;
  const packageDef = {
    weight: s.weight,
    dimensions: (s.length > 0 && s.width > 0 && s.height > 0) ? { length: s.length, width: s.width, height: s.height } : undefined,
    customerReferences: [{ value: s.reference, typeCode: "CU" }]
  };
  return {
    plannedShippingDateAndTime: planned,
    pickup: { isRequested: Boolean(config.requestPickup) },
    productCode: config.productCode || "P",
    accounts: [{ typeCode: "shipper", number: config.accountNumber }],
    customerDetails: {
      shipperDetails: { postalAddress: postal(config.shipper), contactInformation: contact(config.shipper) },
      receiverDetails: { postalAddress: postal(preview.recipient), contactInformation: contact(preview.recipient) }
    },
    content: {
      packages: Array.from({ length: Math.max(1, s.packageCount) }, () => packageDef),
      isCustomsDeclarable: Boolean(s.declaredValue > 0),
      description: s.contents,
      incoterm: s.incoterm || "DAP",
      unitOfMeasurement: "metric",
      declaredValue: s.declaredValue > 0 ? s.declaredValue : undefined,
      declaredValueCurrency: s.declaredValue > 0 ? (s.currency || "EUR") : undefined
    },
    customerReferences: [{ value: s.reference, typeCode: "CU" }]
  };
}

async function updateJiraFromResponse(issueKey, config, response) {
  const fields = {};
  const tracking = response?.shipmentTrackingNumber || response?.trackingNumber || response?.waybill || "";
  if (!tracking) throw new Error("DHL confirmed the request but did not return a shipment tracking number. Jira was not updated.");
  fields[config.trackingFieldId] = String(tracking);
  const values = {
    shipmentId: response?.shipmentTrackingNumber || response?.shipmentId || "",
    productCode: response?.productCode || response?.product?.productCode || "",
    createdAt: new Date().toISOString(),
    estimatedDelivery: response?.estimatedDeliveryDate?.estimatedDeliveryDateAndTime || response?.estimatedDeliveryDate || "",
    statusSummary: (response?.warnings || []).map((x) => x?.message || x?.detail || String(x)).join("; ")
  };
  for (const [key, fieldId] of Object.entries(config.responseMappings || {})) {
    if (fieldId && values[key]) fields[fieldId] = String(values[key]);
  }
  const result = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ fields })
  });
  if (!result.ok) throw new Error(`Shipment created but Jira field update failed: ${await result.text()}`);
  return { tracking, fieldsUpdated: Object.keys(fields).length };
}

resolver.define("getShippingSettings", async () => {
  const config = await getConfig();
  const creds = await getCredentials();
  return { config, hasCredentials: Boolean(creds.username && creds.password) };
});

resolver.define("saveShippingSettings", async ({ payload }) => {
  const incoming = mergeConfig(payload?.config || {});
  incoming.environment = incoming.environment === "production" ? "production" : "test";
  incoming.sourceProjects = (incoming.sourceProjects || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  await kvs.set(CONFIG_KEY, incoming);
  if (payload?.username?.trim()) await kvs.setSecret(USER_SECRET, payload.username.trim());
  if (payload?.password) await kvs.setSecret(PASS_SECRET, payload.password);
  const creds = await getCredentials();
  return { ok: true, hasCredentials: Boolean(creds.username && creds.password) };
});

resolver.define("getShippingJiraMetadata", async () => {
  const response = await api.asApp().requestJira(route`/rest/api/3/field`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await response.text());
  const fields = await response.json();
  return fields.map((f) => ({ id: f.id, name: f.name, custom: Boolean(f.custom), type: f.schema?.type || "" })).sort((a, b) => a.name.localeCompare(b.name));
});

resolver.define("getShipmentPreview", async ({ payload }) => {
  const config = await getConfig();
  const issue = await readIssue(payload?.issueKey, config);
  const preview = buildPreview(issue, config);
  return { preview, errors: validateLocal(preview, config) };
});

resolver.define("validateShipmentAddress", async ({ payload }) => {
  const config = await getConfig();
  const issue = await readIssue(payload?.issueKey, config);
  const preview = buildPreview(issue, config);
  const errors = validateLocal(preview, config);
  if (errors.length) return { ok: false, local: true, errors, preview };
  try {
    const validation = await validateAddressWithDhl(config, preview);
    await logActivity("info", "DHL address validation passed", "Destination address passed DHL validation.", issue.key);
    return { ok: true, preview, validation };
  } catch (e) {
    await logActivity("warning", "DHL address validation failed", String(e.message).slice(0, 500), issue.key);
    return { ok: false, errors: [e.message], preview, status: e.status || 0, details: e.body || null };
  }
});

resolver.define("createDhlShipment", async ({ payload }) => {
  const config = await getConfig();
  const issue = await readIssue(payload?.issueKey, config);
  const preview = buildPreview(issue, config);
  const errors = validateLocal(preview, config);
  if (errors.length) return { ok: false, errors, preview };
  if (config.environment === "production" && payload?.confirmedProduction !== true) return { ok: false, errors: ["Production confirmation is required before creating a real DHL shipment."], preview };

  const fingerprint = `${issue.key}:${preview.existingTracking || "new"}:${preview.recipient.postalCode}:${preview.shipment.reference}:${preview.shipment.weight}`;
  const lockKey = `dhl-shipment-lock:${issue.id}`;
  const existing = await kvs.get(lockKey);
  if (existing?.fingerprint === fingerprint && Date.now() - Number(existing.createdAt || 0) < 15 * 60 * 1000) {
    return { ok: false, errors: ["A matching shipment request was already submitted recently. Duplicate creation has been blocked."] };
  }

  const validation = await validateAddressWithDhl(config, preview);
  if (!validation) return { ok: false, errors: ["DHL address validation returned no result."] };
  await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "submitting" });
  await logActivity("info", "Shipment creation requested", `MyDHL ${config.environment} request started.`, issue.key);
  try {
    const response = await dhlFetch(config, "/shipments", { method: "POST", body: JSON.stringify(buildShipmentRequest(config, preview)) });
    const jira = await updateJiraFromResponse(issue.key, config, response);
    await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "created", tracking: jira.tracking });
    await logActivity("info", "DHL shipment created", `Waybill ${String(jira.tracking).slice(-4).padStart(String(jira.tracking).length, "*")} written to Jira.`, issue.key);
    const documents = (response?.documents || []).map((d) => ({ typeCode: d.typeCode || d.type, formatCode: d.formatCode || d.format, contentLength: d.content ? String(d.content).length : 0 }));
    return { ok: true, trackingNumber: jira.tracking, fieldsUpdated: jira.fieldsUpdated, documents, warnings: response?.warnings || [] };
  } catch (e) {
    await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "uncertain", errorStatus: e.status || 0 });
    await logActivity("error", "DHL shipment creation failed", String(e.message).slice(0, 500), issue.key);
    return { ok: false, errors: [e.message], status: e.status || 0, uncertain: !e.status || e.status >= 500 };
  }
});

export const handler = resolver.getDefinitions();
