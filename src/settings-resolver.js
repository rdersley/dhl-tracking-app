import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { getDeliveryManagerConfig, saveDeliveryManagerConfig } from "./config.js";

const resolver = new Resolver();

async function jiraJson(path) {
  const response = await api.asApp().requestJira(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return { ok: false, status: response.status, error: await response.text() };
  }
  return { ok: true, data: await response.json() };
}

function uniqueStatusOptions(data) {
  const names = new Set();
  for (const issueType of data || []) {
    for (const status of issueType.statuses || []) {
      const name = String(status.name || "").trim();
      if (name) names.add(name);
    }
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: name, value: name }));
}

resolver.define("getConfig", async () => getDeliveryManagerConfig());

resolver.define("saveConfig", async ({ payload }) => {
  const config = await saveDeliveryManagerConfig(payload?.config || {});
  return { ok: true, config };
});

resolver.define("getOptions", async () => {
  const [projectsResult, fieldsResult] = await Promise.all([
    jiraJson(route`/rest/api/3/project/search?maxResults=100`),
    jiraJson(route`/rest/api/3/field`),
  ]);

  return {
    projects: projectsResult.ok
      ? (projectsResult.data?.values || [])
          .map((p) => ({ label: `${p.key} — ${p.name}`, value: p.key }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [],
    fields: fieldsResult.ok
      ? (fieldsResult.data || [])
          .map((f) => ({ label: String(f.name || f.id), value: f.id }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [],
  };
});

resolver.define("getProjectStatuses", async ({ payload }) => {
  const projectKey = String(payload?.projectKey || "").trim();
  if (!projectKey) return { ok: false, projectKey: "", statuses: [], error: "No project selected" };

  const result = await jiraJson(route`/rest/api/3/project/${projectKey}/statuses`);
  return result.ok
    ? { ok: true, projectKey, statuses: uniqueStatusOptions(result.data) }
    : { ok: false, projectKey, statuses: [], error: `Could not load statuses for ${projectKey}` };
});

resolver.define("validateConfig", async ({ payload }) => {
  const config = payload?.config || (await getDeliveryManagerConfig());
  const checks = [];

  async function checkProject(key, label) {
    if (!key) {
      checks.push({ key: label, ok: false, message: "Not configured" });
      return null;
    }
    const result = await jiraJson(route`/rest/api/3/project/${key}`);
    checks.push({ key: label, ok: result.ok, message: result.ok ? `Found ${result.data?.name || key}` : `Project ${key} not found or inaccessible` });
    return result.ok ? result.data : null;
  }

  const sdProject = await checkProject(config.sdProject, "Service project");
  const hwProject = await checkProject(config.hwProject, "Hardware project");

  const fieldsResult = await jiraJson(route`/rest/api/3/field`);
  const fields = fieldsResult.ok ? fieldsResult.data || [] : [];
  const fieldNamesById = new Map(fields.map((f) => [f.id, f.name || f.id]));
  for (const [label, fieldId] of [
    ["Tracking Number", config.trackingField],
    ["Date Sent", config.dateSentField],
    ["Delivery Status", config.deliveryStatusField],
    ["Date Delivered", config.deliveryDateField],
    ["Signed For", config.signedForField],
    ["Last DHL Check", config.lastDhlCheckField],
  ]) {
    const fieldName = fieldNamesById.get(fieldId);
    checks.push({
      key: label,
      ok: !!fieldName,
      message: fieldName ? `Found ${fieldName}` : `Field ${fieldId || "not configured"} not found`,
    });
  }

  async function checkStatus(projectKey, statusName, label) {
    if (!projectKey || !statusName) {
      checks.push({ key: label, ok: false, message: "Not configured" });
      return;
    }
    const result = await jiraJson(route`/rest/api/3/project/${projectKey}/statuses`);
    const names = result.ok
      ? (result.data || []).flatMap((type) => type.statuses || []).map((s) => String(s.name || "").trim().toLowerCase())
      : [];
    const found = names.includes(String(statusName).trim().toLowerCase());
    checks.push({ key: label, ok: found, message: found ? `Found ${statusName}` : `Status ${statusName} not found in ${projectKey}` });
  }

  if (sdProject) {
    await checkStatus(config.sdProject, config.sdSentStatus, "SD Sent to Hardware status");
    await checkStatus(config.sdProject, config.sdDispatchedStatus, "SD Dispatched status");
    await checkStatus(config.sdProject, config.resolvedStatus, "SD Resolved status");
  }
  if (hwProject) {
    await checkStatus(config.hwProject, config.hwDispatchedStatus, "HW Dispatched status");
  }

  if (config.createEnabled) {
    checks.push({
      key: "HW auto-creation safety",
      ok: !!config.hwIssueType,
      message: config.hwIssueType ? `Enabled with issue type ${config.hwIssueType}` : "Auto-creation is ON but no HW issue type is configured",
    });
  } else {
    checks.push({ key: "HW auto-creation safety", ok: true, message: "OFF — safe reconciliation-only mode" });
  }

  return { ok: checks.every((c) => c.ok), checks };
});

export const handler = resolver.getDefinitions();
