import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { getDeliveryManagerConfig } from "./config.js";
import { buildHardwareDuplicateState } from "./hardware-core.mjs";

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

async function getSourceIssue(issueKey) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}?fields=summary,description,issuelinks,project,status`);
}

async function getRecordedHardwareKey(issueKey) {
  const result = await jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${CREATED_PROPERTY}`);
  if (!result.ok) return null;
  return result.data?.value?.issueKey || null;
}

async function recordHardwareKey(issueKey, hardwareKey) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${CREATED_PROPERTY}`, {
    method: "PUT",
    body: JSON.stringify({ issueKey: hardwareKey, recordedAt: new Date().toISOString() }),
  });
}

async function inspect(issueKey, config) {
  const issueResult = await getSourceIssue(issueKey);
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

  const recordedKey = await getRecordedHardwareKey(issueKey);
  const duplicate = buildHardwareDuplicateState(issue, config.hwProject, recordedKey);
  return {
    ok: true,
    issueKey,
    issue,
    hwProject: config.hwProject,
    hwIssueType: config.hwIssueType,
    ...duplicate,
  };
}

resolver.define("checkHardwareTicket", async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };
  const config = await getDeliveryManagerConfig();
  return inspect(issueKey, config);
});

resolver.define("createHardwareTicket", async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  const force = payload?.force === true;
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };

  const config = await getDeliveryManagerConfig();
  if (!config.hwProject) return { ok: false, error: "Hardware project is not configured." };
  if (!config.hwIssueType) return { ok: false, error: "Hardware issue type is not configured." };

  // Important: always re-read links immediately before creating. The UI check is advisory;
  // this backend check is the actual duplicate guard.
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
      fields: {
        project: { key: config.hwProject },
        issuetype: { name: config.hwIssueType },
        summary: state.issue?.fields?.summary || `Hardware request for ${issueKey}`,
        description: state.issue?.fields?.description ?? undefined,
      },
    }),
  });

  if (!createResult.ok) {
    return { ok: false, error: `Hardware ticket creation failed: ${createResult.error}` };
  }

  const hardwareKey = createResult.data?.key;
  if (!hardwareKey) return { ok: false, error: "Jira created the issue but returned no issue key." };

  // Record the created key before linking. If linking fails, a retry will still surface the
  // existing HW ticket rather than silently creating another one.
  await recordHardwareKey(issueKey, hardwareKey);

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
});

export const handler = resolver.getDefinitions();
