import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import {
  getDeliveryManagerConfig,
  saveDeliveryManagerConfig,
  hasDhlApiKey,
  setDhlApiKey,
  clearDhlApiKey,
  getDhlApiKey,
} from "./config.js";

const resolver = new Resolver();

async function jiraJson(path) {
  const response = await api.asApp().requestJira(path, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
  return { ok: true, data: await response.json() };
}

function uniqueStatusOptions(data) {
  const names = new Set();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.values) ? data.values : [];
  for (const row of rows) {
    if (Array.isArray(row?.statuses)) {
      for (const status of row.statuses) {
        const name = String(status?.name || "").trim();
        if (name) names.add(name);
      }
    } else {
      const name = String(row?.name || "").trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ label: name, value: name }));
}

async function loadProjectStatuses(projectKey) {
  const attempts = [];
  const v3 = await jiraJson(route`/rest/api/3/project/${projectKey}/statuses`);
  if (v3.ok) {
    const statuses = uniqueStatusOptions(v3.data);
    attempts.push(`v3:${statuses.length}`);
    if (statuses.length) return { ok: true, statuses, source: "v3 project statuses", attempts };
  } else attempts.push(`v3 HTTP ${v3.status}`);
  const v2 = await jiraJson(route`/rest/api/2/project/${projectKey}/statuses`);
  if (v2.ok) {
    const statuses = uniqueStatusOptions(v2.data);
    attempts.push(`v2:${statuses.length}`);
    if (statuses.length) return { ok: true, statuses, source: "v2 project statuses", attempts };
  } else attempts.push(`v2 HTTP ${v2.status}`);
  return { ok: false, statuses: [], source: "none", attempts, error: `Jira returned no usable statuses for ${projectKey} (${attempts.join(", ")})` };
}

resolver.define("getConfig", async () => ({ ...(await getDeliveryManagerConfig()), dhlApiKeyConfigured: await hasDhlApiKey() }));
resolver.define("saveConfig", async ({ payload }) => ({ ok: true, config: await saveDeliveryManagerConfig(payload?.config || {}) }));

resolver.define("saveDhlCredentials", async ({ payload }) => {
  const apiKey = String(payload?.apiKey || "").trim();
  const clear = payload?.clear === true;
  if (clear) {
    await clearDhlApiKey();
    return { ok: true, configured: false, message: "DHL API key cleared." };
  }
  if (!apiKey) return { ok: false, configured: await hasDhlApiKey(), message: "Enter an API key before saving credentials." };
  await setDhlApiKey(apiKey);
  return { ok: true, configured: true, message: "DHL API key saved securely." };
});

resolver.define("testDhlConnection", async ({ payload }) => {
  const config = { ...(await getDeliveryManagerConfig()), ...(payload?.config || {}) };
  const apiKey = await getDhlApiKey();
  if (!apiKey) return { ok: false, message: "No DHL API key is configured." };
  const baseUrl = String(config.dhlApiUrl || "").trim();
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api-eu.dhl.com") {
      return { ok: false, message: "The DHL API URL must use https://api-eu.dhl.com." };
    }
    const separator = baseUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}${separator}trackingNumber=0000000000`, {
      method: "GET",
      headers: { "DHL-API-Key": apiKey, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, message: "DHL rejected the API credentials." };
    if (response.status === 429) return { ok: true, status: 429, message: "DHL accepted the credentials but rate-limited the test request." };
    if (response.status >= 500) return { ok: false, status: response.status, message: `DHL service returned HTTP ${response.status}.` };
    return { ok: true, status: response.status, message: `DHL API connection reached successfully (HTTP ${response.status}).` };
  } catch (error) {
    return { ok: false, message: `DHL API test failed: ${String(error)}` };
  }
});

resolver.define("getOptions", async () => {
  const [projectsResult, fieldsResult] = await Promise.all([
    jiraJson(route`/rest/api/3/project/search?maxResults=100`),
    jiraJson(route`/rest/api/3/field`),
  ]);
  return {
    projects: projectsResult.ok ? (projectsResult.data?.values || []).map((p) => ({ label: `${p.key} — ${p.name}`, value: p.key })).sort((a, b) => a.label.localeCompare(b.label)) : [],
    fields: fieldsResult.ok ? (fieldsResult.data || []).map((f) => ({ label: String(f.name || f.id), value: f.id })).sort((a, b) => a.label.localeCompare(b.label)) : [],
  };
});

resolver.define("getProjectStatuses", async ({ payload }) => {
  const projectKey = String(payload?.projectKey || "").trim();
  if (!projectKey) return { ok: false, projectKey: "", statuses: [], error: "No project selected" };
  return { projectKey, ...(await loadProjectStatuses(projectKey)) };
});

resolver.define("validateConfig", async ({ payload }) => {
  const config = payload?.config || (await getDeliveryManagerConfig());
  const checks = [];
  async function checkProject(key, label) {
    if (!key) { checks.push({ key: label, ok: false, message: "Not configured" }); return false; }
    const result = await jiraJson(route`/rest/api/3/project/${key}`);
    checks.push({ key: label, ok: result.ok, message: result.ok ? `Found ${result.data?.name || key}` : `Project ${key} not found or inaccessible` });
    return result.ok;
  }
  const sdOk = await checkProject(config.sdProject, "Service project");
  const hwOk = await checkProject(config.hwProject, "Hardware project");
  const fieldsResult = await jiraJson(route`/rest/api/3/field`);
  const fields = fieldsResult.ok ? fieldsResult.data || [] : [];
  const fieldNamesById = new Map(fields.map((f) => [f.id, f.name || f.id]));
  const requiredFields = [
    ["Tracking Number", config.trackingField], ["Date Sent", config.dateSentField], ["Delivery Status", config.deliveryStatusField],
    ["Date Delivered", config.deliveryDateField], ["Signed For", config.signedForField], ["Last DHL Check", config.lastDhlCheckField],
  ];
  if (config.clientRestrictionEnabled) requiredFields.push(["Client restriction field", config.clientField]);
  for (const [label, fieldId] of requiredFields) {
    const fieldName = fieldNamesById.get(fieldId);
    checks.push({ key: label, ok: !!fieldName, message: fieldName ? `Found ${fieldName}` : `Field ${fieldId || "not configured"} not found` });
  }
  const mappings = Array.isArray(config.hwFieldMappings) ? config.hwFieldMappings : [];
  const mappingTargets = new Set();
  let mappingsOk = true;
  for (const [index, mapping] of mappings.entries()) {
    const sourceName = fieldNamesById.get(mapping?.source);
    const targetName = fieldNamesById.get(mapping?.target);
    const duplicateTarget = mappingTargets.has(mapping?.target);
    if (mapping?.target) mappingTargets.add(mapping.target);
    const ok = !!sourceName && !!targetName && !duplicateTarget;
    mappingsOk = mappingsOk && ok;
    checks.push({ key: `HW field mapping ${index + 1}`, ok, message: ok ? `${sourceName} → ${targetName}` : duplicateTarget ? `Target field ${targetName || mapping?.target || "not configured"} is mapped more than once` : `Invalid mapping` });
  }
  if (!mappings.length) checks.push({ key: "HW field mappings", ok: true, message: "No additional SD → HW field mappings configured" });
  async function checkStatus(projectKey, statusName, label) {
    if (!projectKey || !statusName) { checks.push({ key: label, ok: false, message: "Not configured" }); return; }
    const result = await loadProjectStatuses(projectKey);
    const found = result.statuses.some((s) => String(s.value).trim().toLowerCase() === String(statusName).trim().toLowerCase());
    checks.push({ key: label, ok: found, message: found ? `Found ${statusName}` : result.error || `Status ${statusName} not found in ${projectKey}` });
  }
  if (sdOk) {
    await checkStatus(config.sdProject, config.sdSentStatus, "SD Sent to Hardware status");
    await checkStatus(config.sdProject, config.sdDispatchedStatus, "SD Dispatched status");
    await checkStatus(config.sdProject, config.outForDeliveryStatus, "SD Out for Delivery status");
    await checkStatus(config.sdProject, config.awaitingCollectionStatus, "SD Awaiting Collection status");
    await checkStatus(config.sdProject, config.onHoldStatus, "SD On Hold status");
    await checkStatus(config.sdProject, config.failedStatus, "SD Delivery Failed status");
    await checkStatus(config.sdProject, config.resolvedStatus, "SD Resolved status");
  }
  if (hwOk) await checkStatus(config.hwProject, config.hwDispatchedStatus, "HW Dispatched status");
  const apiUrlOk = (() => { try { const u = new URL(config.dhlApiUrl); return u.protocol === "https:" && u.hostname.toLowerCase() === "api-eu.dhl.com"; } catch { return false; } })();
  checks.push({ key: "DHL API URL", ok: apiUrlOk, message: apiUrlOk ? config.dhlApiUrl : "Configure a valid api-eu.dhl.com HTTPS endpoint" });
  const apiKeyOk = await hasDhlApiKey();
  checks.push({ key: "DHL API key", ok: apiKeyOk, message: apiKeyOk ? "Configured securely" : "Not configured" });
  if (config.clientRestrictionEnabled) {
    const valuesOk = Array.isArray(config.clientValues) && config.clientValues.length > 0;
    checks.push({ key: "Client restriction values", ok: valuesOk, message: valuesOk ? `${config.clientValues.length} value(s) configured` : "Restrictions are ON but no client values are configured" });
  } else checks.push({ key: "Client restrictions", ok: true, message: "OFF — all configured-project tickets are eligible" });
  if (config.createEnabled) checks.push({ key: "HW auto-creation safety", ok: !!config.hwIssueType && mappingsOk, message: config.hwIssueType && mappingsOk ? `Enabled with issue type ${config.hwIssueType}; duplicate safeguards active` : "Auto-creation is ON but the HW issue type or field mappings need attention" });
  else checks.push({ key: "HW auto-creation safety", ok: true, message: "OFF — safe reconciliation-only mode" });
  return { ok: checks.every((c) => c.ok), checks };
});

export const handler = resolver.getDefinitions();
