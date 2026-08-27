import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { makeResolver } from "@forge/resolver";

const CONFIG_KEY = "dhl-shipping-config";
const USER_SECRET = "mydhl-api-username";
const PASS_SECRET = "mydhl-api-password";
const LOG_KEY = "dhl-shipping-activity-log";
const TEST_BASE = "https://express.api.dhl.com/mydhlapi/test";
const PROD_BASE = "https://express.api.dhl.com/mydhlapi";
const MAX_LOG = 100;

const DEFAULT = {
  enabled: false,
  environment: "test",
  sourceProjects: [],
  accountNumber: "",
  productCode: "P",
  duplicateMode: "block",
  requestPickup: false,
  trackingFieldId: "",
  notificationLanguage: "en",
  fieldMappings: {
    recipientCompany: "", recipientName: "", recipientPhone: "", recipientEmail: "",
    address1: "", address2: "", address3: "", city: "", province: "", provinceCode: "", postalCode: "", countryCode: "",
    shipmentDate: "", packageCount: "", weight: "", length: "", width: "", height: "", contents: "", reference: "",
    declaredValue: "", currency: "", incoterm: "", exportReason: "", invoiceNumber: "", invoiceDate: "",
    commodityDescription: "", commodityQuantity: "", commodityUnitValue: "", commodityHsCode: "", commodityOriginCountry: "",
    recipientNotificationEmail: ""
  },
  shipper: {
    company: "", name: "", phone: "", email: "", address1: "", address2: "", address3: "", city: "",
    province: "", provinceCode: "", postalCode: "", countryCode: ""
  },
  responseMappings: {
    shipmentId: "", productCode: "", createdAt: "", estimatedDelivery: "", statusSummary: "", pickupConfirmation: "", documentSummary: ""
  }
};

const merge = (saved = {}) => ({
  ...DEFAULT,
  ...saved,
  fieldMappings: { ...DEFAULT.fieldMappings, ...(saved.fieldMappings || {}) },
  shipper: { ...DEFAULT.shipper, ...(saved.shipper || {}) },
  responseMappings: { ...DEFAULT.responseMappings, ...(saved.responseMappings || {}) },
  sourceProjects: Array.isArray(saved.sourceProjects) ? saved.sourceProjects : []
});

const getConfig = async () => merge((await kvs.get(CONFIG_KEY)) || {});
const getCredentials = async () => {
  const [username, password] = await Promise.all([kvs.getSecret(USER_SECRET), kvs.getSecret(PASS_SECRET)]);
  return { username, password };
};
const basicAuth = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const scalar = (value) => value == null ? "" : typeof value === "string" || typeof value === "number" ? String(value) : String(value.value ?? value.name ?? value.displayName ?? value.emailAddress ?? "");
const fieldValue = (issue, id) => id ? scalar(issue?.fields?.[id]) : "";

async function appendLog(level, action, details, issueKey = "") {
  try {
    const current = (await kvs.get(LOG_KEY)) || [];
    current.unshift({ timestamp: new Date().toISOString(), level, action, details, issueKey });
    await kvs.set(LOG_KEY, current.slice(0, MAX_LOG));
  } catch (error) {
    console.log("DHL shipping log write failed", String(error));
  }
}

async function readIssue(issueKey, config) {
  const ids = [config.trackingFieldId, ...Object.values(config.fieldMappings), ...Object.values(config.responseMappings), "project", "summary"].filter(Boolean);
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=${ids.join(",")}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not read Jira issue: ${await response.text()}`);
  return response.json();
}

async function updateJiraFields(issueKey, fields) {
  if (!Object.keys(fields || {}).length) return true;
  const jira = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!jira.ok) throw new Error(await jira.text());
  return true;
}

async function writeFeedback(issueKey, config, message) {
  const fieldId = config.responseMappings?.statusSummary;
  if (!fieldId) return;
  try { await updateJiraFields(issueKey, { [fieldId]: String(message).slice(0, 2000) }); }
  catch (error) { console.log("Could not write DHL feedback to Jira", String(error)); }
}

function buildPreview(issue, config) {
  const m = config.fieldMappings;
  return {
    issueKey: issue.key,
    projectKey: issue.fields?.project?.key || "",
    summary: issue.fields?.summary || "",
    environment: config.environment,
    existingTracking: fieldValue(issue, config.trackingFieldId),
    recipient: {
      company: fieldValue(issue, m.recipientCompany), name: fieldValue(issue, m.recipientName), phone: fieldValue(issue, m.recipientPhone),
      email: fieldValue(issue, m.recipientEmail), address1: fieldValue(issue, m.address1), address2: fieldValue(issue, m.address2),
      address3: fieldValue(issue, m.address3), city: fieldValue(issue, m.city), province: fieldValue(issue, m.province),
      provinceCode: fieldValue(issue, m.provinceCode), postalCode: fieldValue(issue, m.postalCode), countryCode: fieldValue(issue, m.countryCode).toUpperCase()
    },
    shipment: {
      shipmentDate: fieldValue(issue, m.shipmentDate), packageCount: Math.max(1, Number(fieldValue(issue, m.packageCount) || 1)),
      weight: Number(fieldValue(issue, m.weight)), length: Number(fieldValue(issue, m.length)), width: Number(fieldValue(issue, m.width)),
      height: Number(fieldValue(issue, m.height)), contents: fieldValue(issue, m.contents), reference: fieldValue(issue, m.reference) || issue.key,
      declaredValue: Number(fieldValue(issue, m.declaredValue) || 0), currency: fieldValue(issue, m.currency).toUpperCase() || "EUR",
      incoterm: fieldValue(issue, m.incoterm).toUpperCase() || "DAP", exportReason: fieldValue(issue, m.exportReason), invoiceNumber: fieldValue(issue, m.invoiceNumber),
      invoiceDate: fieldValue(issue, m.invoiceDate), commodityDescription: fieldValue(issue, m.commodityDescription),
      commodityQuantity: Number(fieldValue(issue, m.commodityQuantity) || 0), commodityUnitValue: Number(fieldValue(issue, m.commodityUnitValue) || 0),
      commodityHsCode: fieldValue(issue, m.commodityHsCode), commodityOriginCountry: fieldValue(issue, m.commodityOriginCountry).toUpperCase(),
      notificationEmail: fieldValue(issue, m.recipientNotificationEmail) || fieldValue(issue, m.recipientEmail)
    },
    shipper: config.shipper
  };
}

function validateLocally(preview, config) {
  const errors = [];
  const warnings = [];
  if (!config.enabled) errors.push("Shipment creation is disabled by the administrator.");
  if (config.sourceProjects.length && !config.sourceProjects.includes(preview.projectKey)) errors.push(`Project ${preview.projectKey} is not enabled for shipment creation.`);
  if (!config.accountNumber) errors.push("DHL Express account number is not configured.");
  if (!config.trackingFieldId) errors.push("Tracking / waybill Jira field is not configured.");
  if (preview.existingTracking && config.duplicateMode === "block") errors.push("This issue already has a tracking number. Duplicate shipment creation is blocked.");
  if (!preview.recipient.company && !preview.recipient.name) errors.push("Recipient company or contact name is required.");
  if (!preview.recipient.address1) errors.push("Recipient address line 1 is required.");
  if (!preview.recipient.city) errors.push("Recipient city is required.");
  if (!/^[A-Z]{2}$/.test(preview.recipient.countryCode)) errors.push("Recipient country code must be a 2-letter ISO code.");
  if (!(preview.shipment.weight > 0)) errors.push("Package weight must be greater than zero.");
  if (!preview.shipment.contents) errors.push("Shipment contents / description is required.");
  if (preview.shipment.declaredValue > 0 && !/^[A-Z]{3}$/.test(preview.shipment.currency)) errors.push("Declared-value currency must be a 3-letter ISO code.");
  if (preview.shipment.declaredValue > 0 && !preview.shipment.commodityDescription) warnings.push("Declared value is present but no commodity description is mapped. DHL may require customs line-item data.");
  for (const [key, value] of Object.entries({ company: config.shipper.company, name: config.shipper.name, address1: config.shipper.address1, city: config.shipper.city, countryCode: config.shipper.countryCode })) {
    if (!value) errors.push(`Shipper ${key} is required.`);
  }
  return { errors, warnings };
}

async function callDhl(config, path, options = {}) {
  const { username, password } = await getCredentials();
  if (!username || !password) throw new Error("MyDHL API username/password are not configured.");
  const base = config.environment === "production" ? PROD_BASE : TEST_BASE;
  const response = await api.fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuth(username, password),
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const details = Array.isArray(body?.additionalDetails) ? body.additionalDetails.map((x) => x?.message || x?.detail || x).join("; ") : "";
    const message = body?.detail || body?.title || body?.message || details || `DHL returned HTTP ${response.status}`;
    const error = new Error(String(message).slice(0, 1200));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function validateAddress(config, preview) {
  const q = new URLSearchParams({ type: "delivery", countryCode: preview.recipient.countryCode, cityName: preview.recipient.city, strictValidation: "true" });
  if (preview.recipient.postalCode) q.set("postalCode", preview.recipient.postalCode);
  return callDhl(config, `/address-validate?${q}`, { method: "GET" });
}

const contactInformation = (x) => ({ email: x.email || undefined, phone: x.phone || undefined, companyName: x.company || undefined, fullName: x.name || x.company || undefined });
const postalAddress = (x) => ({ postalCode: x.postalCode || undefined, cityName: x.city, countryCode: String(x.countryCode || "").toUpperCase(), provinceName: x.province || undefined, provinceCode: x.provinceCode || undefined, addressLine1: x.address1, addressLine2: x.address2 || undefined, addressLine3: x.address3 || undefined });

function buildShipmentRequest(config, preview) {
  const s = preview.shipment;
  const planned = s.shipmentDate ? `${s.shipmentDate}T12:00:00 GMT+00:00` : `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T12:00:00 GMT+00:00`;
  const packageTemplate = {
    weight: s.weight,
    dimensions: s.length > 0 && s.width > 0 && s.height > 0 ? { length: s.length, width: s.width, height: s.height } : undefined,
    customerReferences: [{ value: s.reference, typeCode: "CU" }]
  };
  const customsDeclarable = s.declaredValue > 0 || Boolean(s.commodityDescription);
  const exportDeclaration = customsDeclarable && s.commodityDescription ? {
    lineItems: [{
      number: 1,
      description: s.commodityDescription,
      price: s.commodityUnitValue > 0 ? s.commodityUnitValue : s.declaredValue,
      quantity: { value: s.commodityQuantity > 0 ? s.commodityQuantity : 1, unitOfMeasurement: "PCS" },
      commodityCodes: s.commodityHsCode ? [{ typeCode: "outbound", value: s.commodityHsCode }] : undefined,
      exportReasonType: s.exportReason || undefined,
      manufacturerCountry: s.commodityOriginCountry || undefined,
      weight: { netValue: s.weight, grossValue: s.weight }
    }],
    invoice: s.invoiceNumber ? { number: s.invoiceNumber, date: s.invoiceDate || new Date().toISOString().slice(0, 10) } : undefined
  } : undefined;
  const outputImageProperties = { printerDPI: 300, encodingFormat: "pdf", imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }] };
  const notification = s.notificationEmail ? [{ typeCode: "email", receiverId: s.notificationEmail, languageCode: config.notificationLanguage || "en" }] : undefined;

  return {
    plannedShippingDateAndTime: planned,
    pickup: { isRequested: Boolean(config.requestPickup) },
    productCode: config.productCode || "P",
    accounts: [{ typeCode: "shipper", number: config.accountNumber }],
    customerDetails: {
      shipperDetails: { postalAddress: postalAddress(config.shipper), contactInformation: contactInformation(config.shipper) },
      receiverDetails: { postalAddress: postalAddress(preview.recipient), contactInformation: contactInformation(preview.recipient) }
    },
    content: {
      packages: Array.from({ length: Math.max(1, s.packageCount) }, () => packageTemplate),
      isCustomsDeclarable: customsDeclarable,
      description: s.contents,
      incoterm: s.incoterm || "DAP",
      unitOfMeasurement: "metric",
      declaredValue: customsDeclarable ? (s.declaredValue || undefined) : undefined,
      declaredValueCurrency: customsDeclarable ? (s.currency || "EUR") : undefined,
      exportDeclaration
    },
    customerReferences: [{ value: s.reference, typeCode: "CU" }],
    outputImageProperties,
    notification
  };
}

function summarizeDhlResponse(response) {
  const warnings = response?.warnings || response?.status?.warnings || [];
  const documents = (response?.documents || []).map((d) => ({
    typeCode: d.typeCode || d.type || "document",
    formatCode: d.formatCode || d.format || "",
    contentLength: d.content ? String(d.content).length : 0
  }));
  return {
    trackingNumber: response?.shipmentTrackingNumber || response?.trackingNumber || response?.waybill || "",
    shipmentId: response?.shipmentTrackingNumber || response?.shipmentId || response?.dispatchConfirmationNumber || "",
    productCode: response?.productCode || response?.product?.productCode || "",
    estimatedDelivery: response?.estimatedDeliveryDate?.estimatedDeliveryDateAndTime || response?.estimatedDeliveryDate || "",
    pickupConfirmation: response?.dispatchConfirmationNumber || response?.pickupConfirmationNumber || "",
    warnings: Array.isArray(warnings) ? warnings.map((w) => w?.message || w?.detail || String(w)) : [],
    documents,
    documentSummary: documents.map((d) => `${d.typeCode}${d.formatCode ? ` (${d.formatCode})` : ""}`).join(", ")
  };
}

async function writeResponseToJira(issueKey, config, response) {
  const summary = summarizeDhlResponse(response);
  if (!summary.trackingNumber) throw new Error("DHL confirmed the request but did not return a tracking/waybill number. Jira was not updated.");
  const values = {
    shipmentId: summary.shipmentId,
    productCode: summary.productCode,
    createdAt: new Date().toISOString(),
    estimatedDelivery: summary.estimatedDelivery,
    statusSummary: summary.warnings.join("; ") || "Shipment created successfully",
    pickupConfirmation: summary.pickupConfirmation,
    documentSummary: summary.documentSummary
  };
  const fields = { [config.trackingFieldId]: String(summary.trackingNumber) };
  for (const [key, id] of Object.entries(config.responseMappings || {})) if (id && values[key]) fields[id] = String(values[key]);
  try { await updateJiraFields(issueKey, fields); }
  catch (error) { throw new Error(`DHL shipment was created, but Jira update failed: ${error.message}`); }
  return { ...summary, fieldsUpdated: Object.keys(fields).length };
}

export const handler = makeResolver({
  async getShippingSettings() {
    const [config, credentials] = await Promise.all([getConfig(), getCredentials()]);
    return { config, hasCredentials: Boolean(credentials.username && credentials.password) };
  },

  async saveShippingSettings({ payload }) {
    const config = merge(payload?.config || {});
    config.environment = config.environment === "production" ? "production" : "test";
    config.sourceProjects = (config.sourceProjects || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    config.accountNumber = String(config.accountNumber || "").trim();
    config.productCode = String(config.productCode || "P").trim().toUpperCase();
    await kvs.set(CONFIG_KEY, config);
    if (payload?.username?.trim()) await kvs.setSecret(USER_SECRET, payload.username.trim());
    if (payload?.password) await kvs.setSecret(PASS_SECRET, payload.password);
    const credentials = await getCredentials();
    await appendLog("info", "Shipment settings saved", `Environment: ${config.environment}. Shipment creation ${config.enabled ? "enabled" : "disabled"}.`);
    return { ok: true, hasCredentials: Boolean(credentials.username && credentials.password) };
  },

  async getShippingJiraMetadata() {
    const response = await api.asApp().requestJira(route`/rest/api/3/field`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).map((f) => ({ id: f.id, name: f.name, custom: Boolean(f.custom), type: f.schema?.type || "" })).sort((a, b) => a.name.localeCompare(b.name));
  },

  async testMyDhlCredentials() {
    const config = await getConfig();
    const q = new URLSearchParams({ type: "pickup", countryCode: config.shipper.countryCode || "IE", cityName: config.shipper.city || "Dublin", strictValidation: "false" });
    if (config.shipper.postalCode) q.set("postalCode", config.shipper.postalCode);
    try {
      await callDhl(config, `/address-validate?${q}`, { method: "GET" });
      return { ok: true, message: `Connected successfully to MyDHL ${config.environment}.` };
    } catch (error) {
      return { ok: false, message: error.message, status: error.status || 0 };
    }
  },

  async getShipmentPreview({ payload }) {
    const config = await getConfig();
    const issue = await readIssue(payload?.issueKey, config);
    const preview = buildPreview(issue, config);
    const validation = validateLocally(preview, config);
    return { preview, ...validation };
  },

  async validateShipmentAddress({ payload }) {
    const config = await getConfig();
    const issue = await readIssue(payload?.issueKey, config);
    const preview = buildPreview(issue, config);
    const local = validateLocally(preview, config);
    if (local.errors.length) return { ok: false, local: true, ...local, preview };
    try {
      const validation = await validateAddress(config, preview);
      await appendLog("info", "DHL address validation passed", "Destination address passed DHL validation.", issue.key);
      await writeFeedback(issue.key, config, "DHL address validation passed");
      return { ok: true, preview, warnings: local.warnings, validation };
    } catch (error) {
      await appendLog("warning", "DHL address validation failed", String(error.message).slice(0, 500), issue.key);
      await writeFeedback(issue.key, config, `Address validation failed: ${error.message}`);
      return { ok: false, errors: [error.message], warnings: local.warnings, preview, status: error.status || 0, details: error.body || null };
    }
  },

  async createDhlShipment({ payload }) {
    const config = await getConfig();
    const issue = await readIssue(payload?.issueKey, config);
    const preview = buildPreview(issue, config);
    const local = validateLocally(preview, config);
    if (local.errors.length) return { ok: false, ...local, preview };
    if (config.environment === "production" && payload?.confirmedProduction !== true) return { ok: false, errors: ["Production confirmation is required before creating a real DHL shipment."], warnings: local.warnings, preview };
    if (preview.existingTracking && config.duplicateMode === "allow" && payload?.confirmedRedispatch !== true) return { ok: false, errors: ["This ticket already has a tracking number. Re-dispatch confirmation is required."], warnings: local.warnings, preview };

    const fingerprint = `${issue.key}:${preview.recipient.postalCode}:${preview.recipient.countryCode}:${preview.shipment.reference}:${preview.shipment.weight}:${preview.shipment.contents}`;
    const lockKey = `dhl-shipment-lock:${issue.id}`;
    const old = await kvs.get(lockKey);
    if (old?.fingerprint === fingerprint && Date.now() - Number(old.createdAt || 0) < 900000) {
      return { ok: false, errors: [old.state === "created" ? `A matching DHL shipment was already created recently${old.tracking ? ` (${old.tracking})` : ""}.` : "A matching shipment request was submitted recently. Duplicate creation has been blocked."] };
    }

    try {
      const addressResult = await validateAddress(config, preview);
      await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "submitting" });
      await appendLog("info", "Shipment creation requested", `MyDHL ${config.environment} request started.`, issue.key);
      const raw = await callDhl(config, "/shipments", { method: "POST", body: JSON.stringify(buildShipmentRequest(config, preview)) });
      const jiraResult = await writeResponseToJira(issue.key, config, raw);
      await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "created", tracking: jiraResult.trackingNumber });
      await appendLog("info", "DHL shipment created", `Waybill ending ${String(jiraResult.trackingNumber).slice(-4)} written to Jira.`, issue.key);
      return { ok: true, addressValidation: addressResult, ...jiraResult, warnings: [...local.warnings, ...jiraResult.warnings] };
    } catch (error) {
      await kvs.set(lockKey, { fingerprint, createdAt: Date.now(), state: "uncertain", errorStatus: error.status || 0 });
      await appendLog("error", "DHL shipment creation failed", String(error.message).slice(0, 500), issue.key);
      await writeFeedback(issue.key, config, `Shipment creation failed: ${error.message}`);
      return { ok: false, errors: [error.message], warnings: local.warnings, status: error.status || 0, details: error.body || null, uncertain: !error.status || error.status >= 500 };
    }
  },

  async getShippingActivityLog() {
    return (await kvs.get(LOG_KEY)) || [];
  },

  async clearShippingActivityLog() {
    await kvs.set(LOG_KEY, []);
    return { ok: true };
  }
});
