import api, { route } from "@forge/api";
import {
  normalise,
  getLinkedIssueKey,
  buildDispatchRepair,
  buildHardwareCreateFields,
  buildHardwareDuplicateState,
  normaliseRecordedHardwareKeys,
} from "./hardware-core.mjs";
import { getDeliveryManagerConfig } from "./config.js";

const CREATED_PROPERTY = "nuvriqo.delivery-manager.hardware-ticket";

async function search(jql, fields, config) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${config.maxResults}&fields=${fields.join(",")}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).issues ?? [];
}

async function jiraJson(path, options = {}) {
  const response = await api.asApp().requestJira(path, {
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

async function getIssue(issueKey, fields) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=${fields.join(",")}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) return null;
  return response.json();
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

async function updateFields(issueKey, fields) {
  if (!Object.keys(fields).length) return true;
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    console.log(`HW-SYNC: field update failed for ${issueKey}: ${await response.text()}`);
    return false;
  }
  return true;
}

async function transitionTo(issueKey, targetStatus) {
  const transitionsResponse = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/transitions`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!transitionsResponse.ok) return false;

  const transitions = (await transitionsResponse.json()).transitions ?? [];
  const target = transitions.find(
    (item) => normalise(item?.to?.name) === normalise(targetStatus)
  );

  if (!target) {
    console.log(`HW-SYNC: ${issueKey} has no transition to ${targetStatus}`);
    return false;
  }

  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ transition: { id: target.id } }),
    }
  );
  return response.ok;
}

async function addInternalComment(issueKey, text) {
  const response = await api.asApp().requestJira(
    route`/rest/servicedeskapi/request/${issueKey}/comment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ public: false, body: text }),
    }
  );
  return response.ok;
}

async function reconcileDispatchedHardware(config) {
  const fields = [config.trackingField, config.dateSentField, "issuelinks", "status", "summary"];
  const jql =
    `project = ${config.hwProject} ` +
    `AND status = "${config.hwDispatchedStatus}" ` +
    `AND cf[${String(config.trackingField).replace("customfield_", "")}] IS NOT EMPTY ` +
    `AND cf[${String(config.dateSentField).replace("customfield_", "")}] IS NOT EMPTY ` +
    `ORDER BY updated ASC`;

  const hwIssues = await search(jql, fields, config);
  let repaired = 0;

  for (const hwIssue of hwIssues) {
    const sdKey = getLinkedIssueKey(hwIssue, config.sdProject);
    if (!sdKey) {
      console.log(`HW-SYNC: ${hwIssue.key} has no linked ${config.sdProject} issue`);
      continue;
    }

    const sdIssue = await getIssue(sdKey, [config.trackingField, config.dateSentField, "status"]);
    if (!sdIssue) continue;

    const repair = buildDispatchRepair(hwIssue, sdIssue, config);
    if (!repair.ready) continue;

    const fieldsOk = await updateFields(sdKey, repair.fields);
    let transitionOk = true;
    if (repair.transition && config.transitionsEnabled) transitionOk = await transitionTo(sdKey, config.sdDispatchedStatus);

    if (fieldsOk && transitionOk && (Object.keys(repair.fields).length || (repair.transition && config.transitionsEnabled))) {
      repaired += 1;
      if (config.commentsEnabled) {
        await addInternalComment(sdKey, `Hardware dispatch synchronised automatically from ${hwIssue.key}. Tracking Number and Date Sent were verified and the SD workflow was reconciled.`);
      }
      console.log(`HW-SYNC: repaired ${hwIssue.key} -> ${sdKey}`);
    }
  }

  return { checked: hwIssues.length, repaired };
}

async function createMissingHardwareTickets(config) {
  if (!config.createEnabled) {
    console.log("HW-SYNC: automatic HW ticket creation is disabled; reconciliation-only mode");
    return { checked: 0, created: 0, skippedDuplicates: 0, autoCreateEnabled: false };
  }
  if (!config.hwIssueType) {
    console.log("HW-SYNC: auto-creation enabled but HW issue type is not configured");
    return { checked: 0, created: 0, skippedDuplicates: 0, autoCreateEnabled: true, blocked: "hw-issue-type-not-configured" };
  }

  const mappedSources = (config.hwFieldMappings || []).map((item) => item.source).filter(Boolean);
  const sourceFields = [...new Set(["summary", "description", "issuelinks", "status", ...mappedSources])];
  const sdIssues = await search(
    `project = ${config.sdProject} AND status = "${config.sdSentStatus}" ORDER BY updated ASC`,
    sourceFields,
    config
  );

  let created = 0;
  let skippedDuplicates = 0;
  let safeguardStopped = false;

  for (const sdIssue of sdIssues) {
    const recordedKeys = await getRecordedHardwareKeys(sdIssue.key);
    const duplicateState = buildHardwareDuplicateState(sdIssue, config.hwProject, recordedKeys);
    if (duplicateState.duplicate) {
      skippedDuplicates += 1;
      continue;
    }

    const fresh = await getIssue(sdIssue.key, sourceFields);
    if (!fresh) continue;
    const freshRecordedKeys = await getRecordedHardwareKeys(sdIssue.key);
    const freshDuplicate = buildHardwareDuplicateState(fresh, config.hwProject, freshRecordedKeys);
    if (freshDuplicate.duplicate) {
      skippedDuplicates += 1;
      continue;
    }

    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fields: buildHardwareCreateFields(fresh, sdIssue.key, config) }),
    });

    if (!response.ok) {
      console.log(`HW-SYNC: failed creating HW issue for ${sdIssue.key}: ${await response.text()}`);
      continue;
    }

    const createdIssue = await response.json();
    if (!createdIssue?.key) {
      console.log(`HW-SYNC: Jira created an HW issue for ${sdIssue.key} but returned no key; stopping auto-create cycle`);
      safeguardStopped = true;
      break;
    }

    const recordResult = await recordHardwareKey(sdIssue.key, createdIssue.key);
    if (!recordResult.ok) {
      console.log(`HW-SYNC: CRITICAL - created ${createdIssue.key} for ${sdIssue.key} but could not record duplicate safeguard; auto-create cycle stopped`);
      safeguardStopped = true;
      break;
    }

    const linkResponse = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: { name: config.hwLinkType || "Relates" },
        inwardIssue: { key: sdIssue.key },
        outwardIssue: { key: createdIssue.key },
      }),
    });

    if (!linkResponse.ok) {
      console.log(`HW-SYNC: created ${createdIssue.key} but linking to ${sdIssue.key} failed; recorded safeguard will prevent duplicate retry`);
      continue;
    }

    created += 1;
    if (config.commentsEnabled) {
      await addInternalComment(sdIssue.key, `Hardware ticket ${createdIssue.key} was created and linked automatically.`);
    }
  }

  return { checked: sdIssues.length, created, skippedDuplicates, autoCreateEnabled: true, safeguardStopped };
}

export async function runHardwareSync() {
  console.log("HW-SYNC: starting hardware handover reconciliation");
  try {
    const config = await getDeliveryManagerConfig();
    const dispatch = await reconcileDispatchedHardware(config);
    const creation = await createMissingHardwareTickets(config);
    const result = { ok: !creation.safeguardStopped, dispatch, creation };
    console.log(
      `HW-SYNC: complete; dispatched checked=${dispatch.checked}, repaired=${dispatch.repaired}, ` +
      `sent-to-hardware checked=${creation.checked}, created=${creation.created}, duplicate-skips=${creation.skippedDuplicates}`
    );
    return result;
  } catch (error) {
    const result = { ok: false, error: String(error) };
    console.log(`HW-SYNC: failed: ${result.error}`);
    return result;
  }
}
