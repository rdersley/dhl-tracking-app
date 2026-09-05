import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import {
  getDeliveryManagerConfig,
  saveDeliveryManagerConfig,
  hasDhlApiKey,
  setDhlApiKey,
  clearDhlApiKey,
  getDhlApiKey,
  getDhlShippingCredentials,
  hasDhlShippingCredentials,
  setDhlShippingCredentials,
  clearDhlShippingCredentials,
} from "./config.js";
import { buildEligibleIssueJql } from "./dhl-config-core.mjs";
import { getDeliveryManagerHealth } from "./health.js";

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

function namedOptions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: name, value: name }));
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

function jqlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function searchPreview(jql, maxResults = 25) {
  try {
    const response = await api.asApp().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&maxResults=${maxResults}&fields=summary,status`,
      { method: "GET", headers: { Accept: "application/json" } }
    );
    if (!response.ok) return { ok: false, count: 0, issues: [], error: await response.text() };
    const data = await response.json();
    const issues = data?.issues || [];
    return {
      ok: true,
      count: issues.length,
      capped: issues.length >= maxResults,
      issues: issues.slice(0, 5).map((issue) => ({ key: issue.key, summary: issue.fields?.summary || "", status: issue.fields?.status?.name || "" })),
    };
  } catch (error) {
    return { ok: false, count: 0, issues: [], error: String(error) };
  }
}

resolver.define("getConfig", async () => ({
  ...(await getDeliveryManagerConfig()),
  dhlApiKeyConfigured: await hasDhlApiKey(),
  dhlShippingCredentialsConfigured: await hasDhlShippingCredentials(),
}));
resolver.define("saveConfig", async ({ payload }) => ({ ok: true, config: await saveDeliveryManagerConfig(payload?.config || {}) }));
resolver.define("getRuntimeHealth", async () => getDeliveryManagerHealth());

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

resolver.define("saveDhlShippingCredentials", async ({ payload }) => {
  const clear = payload?.clear === true;
  if (clear) {
    await clearDhlShippingCredentials();
    return { ok: true, configured: false, message: "DHL Express shipping credentials cleared." };
  }
  const username = String(payload?.username || "").trim();
  const password = String(payload?.password || "");
  if (!username || !password) return { ok: false, configured: await hasDhlShippingCredentials(), message: "Enter both the DHL Express API username and password." };
  await setDhlShippingCredentials(username, password);
  return { ok: true, configured: true, message: "DHL Express shipping credentials saved securely." };
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
    const response = await api.fetch(`${baseUrl}${separator}trackingNumber=0000000000`, {
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

resolver.define("testDhlShippingConnection", async ({ payload }) => {
  const config = { ...(await getDeliveryManagerConfig()), ...(payload?.config || {}) };
  const credentials = await getDhlShippingCredentials();
  if (!credentials.username || !credentials.password) return { ok: false, message: "No DHL Express shipping credentials are configured." };
  const baseUrl = String(config.dhlShippingApiUrl || "").replace(/\/$/, "");
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "express.api.dhl.com" || !parsed.pathname.startsWith("/mydhlapi")) {
      return { ok: false, message: "The DHL shipping API URL must use the express.api.dhl.com MyDHL API." };
    }
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
    const response = await api.fetch(`${baseUrl}/rates`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, message: "DHL Express rejected the shipping credentials." };
    if (response.status >= 500) return { ok: false, status: response.status, message: `DHL Express service returned HTTP ${response.status}.` };
    return { ok: true, status: response.status, message: `DHL Express shipping API reached successfully (HTTP ${response.status}).` };
  } catch (error) {
    return { ok: false, message: `DHL Express shipping test failed: ${String(error)}` };
  }
});

resolver.define("getOptions", async () => {
  const [projectsResult, fieldsResult, issueTypesResult, linkTypesResult, resolutionsResult] = await Promise.all([
    jiraJson(route`/rest/api/3/project/search?maxResults=100`),
    jiraJson(route`/rest/api/3/field`),
    jiraJson(route`/rest/api/3/issuetype`),
    jiraJson(route`/rest/api/3/issueLinkType`),
    jiraJson(route`/rest/api/3/resolution`),
  ]);
  return {
    projects: projectsResult.ok ? (projectsResult.data?.values || []).map((p) => ({ label: `${p.key} — ${p.name}`, value: p.key })).sort((a, b) => a.label.localeCompare(b.label)) : [],
    fields: fieldsResult.ok ? (fieldsResult.data || []).map((f) => ({ label: String(f.name || f.id), value: f.id })).sort((a, b) => a.label.localeCompare(b.label)) : [],
    issueTypes: issueTypesResult.ok ? namedOptions(issueTypesResult.data) : [],
    linkTypes: linkTypesResult.ok ? namedOptions(linkTypesResult.data?.issueLinkTypes) : [],
    resolutions: resolutionsResult.ok ? namedOptions(resolutionsResult.data) : [],
  };
});

resolver.define("getProjectStatuses", async ({ payload }) => {
  const projectKey = String(payload?.projectKey || "").trim();
  if (!projectKey) return { ok: false, projectKey: "", statuses: [], error: "No project selected" };
  return { projectKey, ...(await loadProjectStatuses(projectKey)) };
});

resolver.define("getOperationalPreview", async ({ payload }) => {
  const config = { ...(await getDeliveryManagerConfig()), ...(payload?.config || {}) };
  const handoverJql = `project = ${jqlQuote(config.sdProject)} AND status = ${jqlQuote(config.sdSentStatus)}`;
  const dispatchedHwJql = `project = ${jqlQuote(config.hwProject)} AND status = ${jqlQuote(config.hwDispatchedStatus)}`;
  const dhlJql = buildEligibleIssueJql(config);
  const [handover, dispatchedHardware, dhlEligible] = await Promise.all([
    searchPreview(handoverJql),
    searchPreview(dispatchedHwJql),
    searchPreview(dhlJql),
  ]);
  return {
    ok: handover.ok && dispatchedHardware.ok && dhlEligible.ok,
    generatedAt: new Date().toISOString(),
    autoCreateEnabled: config.createEnabled === true,
    transitionsEnabled: config.transitionsEnabled !== false,
    commentsEnabled: config.commentsEnabled !== false,
    dhlApiKeyConfigured: await hasDhlApiKey(),
    dhlShippingEnabled: config.dhlShippingEnabled === true,
    dhlShippingEnvironment: config.dhlShippingEnvironment,
    dhlShippingCredentialsConfigured: await hasDhlShippingCredentials(),
    queries: { handoverJql, dispatchedHwJql, dhlJql },
    handover,
    dispatchedHardware,
    dhlEligible,
  };
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

  const [fieldsResult, issueTypesResult, linkTypesResult, resolutionsResult] = await Promise.all([
    jiraJson(route`/rest/api/3/field`),
    jiraJson(route`/rest/api/3/issuetype`),
    jiraJson(route`/rest/api/3/issueLinkType`),
    jiraJson(route`/rest/api/3/resolution`),
  ]);

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

  const issueTypeNames = new Set((issueTypesResult.ok ? issueTypesResult.data || [] : []).map((x) => String(x?.name || "").toLowerCase()));
  const hwIssueTypeOk = !!config.hwIssueType && issueTypeNames.has(String(config.hwIssueType).toLowerCase());
  checks.push({ key: "HW issue type", ok: hwIssueTypeOk, message: hwIssueTypeOk ? `Found ${config.hwIssueType}` : `Issue type ${config.hwIssueType || "not configured"} not found` });

  const linkTypeNames = new Set((linkTypesResult.ok ? linkTypesResult.data?.issueLinkTypes || [] : []).map((x) => String(x?.name || "").toLowerCase()));
  const linkTypeOk = !!config.hwLinkType && linkTypeNames.has(String(config.hwLinkType).toLowerCase());
  checks.push({ key: "Issue link type", ok: linkTypeOk, message: linkTypeOk ? `Found ${config.hwLinkType}` : `Issue link type ${config.hwLinkType || "not configured"} not found` });

  const resolutionNames = new Set((resolutionsResult.ok ? resolutionsResult.data || [] : []).map((x) => String(x?.name || "").toLowerCase()));
  const resolutionOk = !config.transitionsEnabled || !config.resolutionName || resolutionNames.has(String(config.resolutionName).toLowerCase());
  checks.push({ key: "Delivery resolution", ok: resolutionOk, message: resolutionOk ? (config.resolutionName || "No resolution will be set") : `Resolution ${config.resolutionName} not found` });

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
    checks.push({ key: `HW field mapping ${index + 1}`, ok, message: ok ? `${sourceName} → ${targetName}` : duplicateTarget ? `Target field ${targetName || mapping?.target || "not configured"} is mapped more than once` : "Invalid mapping" });
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

  if (config.dhlShippingEnabled) {
    const shippingCredentialsOk = await hasDhlShippingCredentials();
    const shippingUrlOk = (() => { try { const u = new URL(config.dhlShippingApiUrl); return u.protocol === "https:" && u.hostname.toLowerCase() === "express.api.dhl.com" && u.pathname.startsWith("/mydhlapi"); } catch { return false; } })();
    checks.push({ key: "DHL shipment creation", ok: true, message: `${config.dhlShippingEnvironment === "production" ? "PRODUCTION" : "TEST"} mode enabled` });
    checks.push({ key: "DHL shipping API URL", ok: shippingUrlOk, message: shippingUrlOk ? config.dhlShippingApiUrl : "Configure a valid express.api.dhl.com MyDHL API endpoint" });
    checks.push({ key: "DHL shipping credentials", ok: shippingCredentialsOk, message: shippingCredentialsOk ? "Configured securely" : "Not configured" });
    checks.push({ key: "DHL shipping account", ok: Boolean(config.dhlShippingAccountNumber || config.dhlAccountNumber), message: config.dhlShippingAccountNumber || config.dhlAccountNumber || "Not configured" });
    checks.push({ key: "DHL product code", ok: Boolean(config.dhlProductCode), message: config.dhlProductCode || "Not configured" });
  } else {
    checks.push({ key: "DHL shipment creation", ok: true, message: "OFF — tracking-only mode" });
  }

  if (config.clientRestrictionEnabled) {
    const valuesOk = Array.isArray(config.clientValues) && config.clientValues.length > 0;
    checks.push({ key: "Client restriction values", ok: valuesOk, message: valuesOk ? `${config.clientValues.length} value(s) configured` : "Restrictions are ON but no client values are configured" });
  } else checks.push({ key: "Client restrictions", ok: true, message: "OFF — all configured-project tickets are eligible" });

  if (config.createEnabled) checks.push({ key: "HW auto-creation safety", ok: hwIssueTypeOk && linkTypeOk && mappingsOk, message: hwIssueTypeOk && linkTypeOk && mappingsOk ? `Enabled with issue type ${config.hwIssueType}; duplicate safeguards active` : "Auto-creation is ON but the issue type, link type or field mappings need attention" });
  else checks.push({ key: "HW auto-creation safety", ok: true, message: "OFF — safe reconciliation-only mode" });

  return { ok: checks.every((c) => c.ok), checks };
});

export const handler = resolver.getDefinitions();
