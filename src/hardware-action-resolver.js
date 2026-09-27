import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { getDeliveryManagerConfig } from "./config.js";
import { guardIssueResolver, requireProjectPermission, AccessDeniedError } from "./access.js";
import { missingSettings } from "./access-core.mjs";
import {
  buildHardwareCreateFields,
  buildHardwareDuplicateState,
  normaliseRecordedHardwareKeys,
} from "./hardware-core.mjs";

const resolver = new Resolver();
const CREATED_PROPERTY = "nuvriqo.delivery-manager.hardware-ticket";

async function jiraJson(path, options = {}) {
  const response = await api.asApp().requestJira(path, {
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    return { ok: false, status: response.status, error: await response.text() };
  }
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

function sourceFields(config) {
  const mapped = (config.hwFieldMappings || []).map((item) => item.source).filter(Boolean);
  return [...new Set(["summary", "description", "issuelinks", "project", "status", ...mapped])];
}

async function getSourceIssue(issueKey, config) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}?fields=${sourceFields(config).join(",")}`);
}

async function getRecordedHardwareKeys(issueKey) {
  const result = await jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${CREATED_PROPERTY}`);
  if (!result.ok) return [];
  const value = result.data?.value || {};
  return normaliseRecordedHardwareKeys(value.issueKeys || value.issueKey || []);
}

async function recordHardwareKey(issueKey, hardwareKey) {
  const currentKeys = await getRecordedHardwareKeys(issueKey);
  const issueKeys = [...new Set([...currentKeys, hardwareKey])];
  return jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${CREATED_PROPERTY}`, {
    method: "PUT",
    body: JSON.stringify({
      issueKey: issueKeys[0] || hardwareKey,
      issueKeys,
      lastCreatedKey: hardwareKey,
      recordedAt: new Date().toISOString(),
    }),
  });
}

async function inspect(issueKey, config) {
  const issueResult = await getSourceIssue(issueKey, config);
  if (!issueResult.ok) return { ok: false, error: `Could not read ${issueKey}: ${issueResult.error}` };

  const issue = issueResult.data;
  const projectKey = String(issue?.fields?.project?.key || "");
  if (projectKey.toUpperCase() !== String(config.sdProject || "").toUpperCase()) {
    return {
      ok: false,
      wrongProject: true,
      error: `This action is configured for ${config.sdProject} issues, not ${projectKey || "this project"}.`,
    };
  }

  const recordedKeys = await getRecordedHardwareKeys(issueKey);
  const duplicate = buildHardwareDuplicateState(issue, config.hwProject, recordedKeys);
  return {
    ok: true,
    issueKey,
    issue,
    hwProject: config.hwProject,
    hwIssueType: config.hwIssueType,
    ...duplicate,
  };
}

// Every resolver below acts with api.asApp(), so guardIssueResolver() first
// confirms that the *calling user* can browse and edit the issue in the payload.
// Viewing the action only needs BROWSE_PROJECTS; creating needs EDIT_ISSUES too.
function notConfigured(config) {
  const missing = missingSettings(config, "hardwareAction");
  return missing.length
    ? { ok: false, notConfigured: true, missing, error: "Hardware ticket creation is not configured yet. A Jira admin must set the service project, hardware project and hardware issue type in Delivery Manager settings." }
    : null;
}

resolver.define("checkHardwareTicket", guardIssueResolver(async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim().toUpperCase();
  const config = await getDeliveryManagerConfig();
  const unconfigured = notConfigured(config);
  if (unconfigured) return unconfigured;
  return inspect(issueKey, config);
}, { permissions: ["BROWSE_PROJECTS"] }));

resolver.define("createHardwareTicket", guardIssueResolver(async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim().toUpperCase();
  const force = payload?.force === true;

  const config = await getDeliveryManagerConfig();
  const unconfigured = notConfigured(config);
  if (unconfigured) return unconfigured;

  // The app creates the hardware ticket as itself, so also make sure the user
  // could have created an issue in the hardware project themselves.
  try {
    await requireProjectPermission(config.hwProject, "CREATE_ISSUES");
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, forbidden: true, error: error.message };
    throw error;
  }

  const state = await inspect(issueKey, config);
  if (!state.ok) return state;
  if (state.duplicate && !force) {
    return {
      ok: false,
      duplicate: true,
      existingKeys: state.existingKeys,
      error: `A hardware ticket already exists for ${issueKey}.`,
    };
  }

  const createResult = await jiraJson(route`/rest/api/3/issue`, {
    method: "POST",
    body: JSON.stringify({
      fields: buildHardwareCreateFields(state.issue, issueKey, config),
    }),
  });

  if (!createResult.ok) {
    return { ok: false, error: `Hardware ticket creation failed: ${createResult.error}` };
  }

  const hardwareKey = createResult.data?.key;
  if (!hardwareKey) return { ok: false, error: "Jira created the issue but returned no issue key." };

  const recordResult = await recordHardwareKey(issueKey, hardwareKey);
  if (!recordResult.ok) {
    return {
      ok: false,
      created: true,
      recordFailed: true,
      hardwareKey,
      error: `${hardwareKey} was created, but Delivery Manager could not record the creation safeguard. Do not retry this action until the ticket is linked or the issue is checked manually.`,
    };
  }

  const linkResult = await jiraJson(route`/rest/api/3/issueLink`, {
    method: "POST",
    body: JSON.stringify({
      type: { name: config.hwLinkType || "Relates" },
      inwardIssue: { key: issueKey },
      outwardIssue: { key: hardwareKey },
    }),
  });

  if (!linkResult.ok) {
    return {
      ok: false,
      created: true,
      linkFailed: true,
      hardwareKey,
      error: `${hardwareKey} was created, but Jira could not link it automatically. Delivery Manager recorded the key to prevent an accidental duplicate on retry.`,
    };
  }

  return {
    ok: true,
    created: true,
    hardwareKey,
    forcedAdditional: force && state.duplicate,
    previousKeys: state.existingKeys,
  };
}, { permissions: ["BROWSE_PROJECTS", "EDIT_ISSUES"] }));

export const handler = resolver.getDefinitions();
