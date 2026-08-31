import api, { route } from "@forge/api";
import {
  normalise,
  getLinkedIssueKey,
  buildDispatchRepair,
} from "./hardware-core.mjs";
import { getDeliveryManagerConfig } from "./config.js";

async function search(jql, fields, config) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${config.maxResults}&fields=${fields.join(",")}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).issues ?? [];
}

async function getIssue(issueKey, fields) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=${fields.join(",")}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) return null;
  return response.json();
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
  const fields = [
    config.trackingField,
    config.dateSentField,
    "issuelinks",
    "status",
    "summary",
  ];

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

    const sdIssue = await getIssue(sdKey, [
      config.trackingField,
      config.dateSentField,
      "status",
    ]);
    if (!sdIssue) continue;

    const repair = buildDispatchRepair(hwIssue, sdIssue, config);
    if (!repair.ready) continue;

    const fieldsOk = await updateFields(sdKey, repair.fields);
    let transitionOk = true;
    if (repair.transition && config.transitionsEnabled) {
      transitionOk = await transitionTo(sdKey, config.sdDispatchedStatus);
    }

    if (
      fieldsOk &&
      transitionOk &&
      (Object.keys(repair.fields).length || (repair.transition && config.transitionsEnabled))
    ) {
      repaired += 1;
      if (config.commentsEnabled) {
        await addInternalComment(
          sdKey,
          `Hardware dispatch synchronised automatically from ${hwIssue.key}. Tracking Number and Date Sent were verified and the SD workflow was reconciled.`
        );
      }
      console.log(`HW-SYNC: repaired ${hwIssue.key} -> ${sdKey}`);
    }
  }

  return { checked: hwIssues.length, repaired };
}

async function createMissingHardwareTickets(config) {
  if (!config.createEnabled) {
    console.log("HW-SYNC: automatic HW ticket creation is disabled; reconciliation-only mode");
    return { checked: 0, created: 0 };
  }

  if (!config.hwIssueType) {
    console.log("HW-SYNC: auto-creation enabled but HW issue type is not configured");
    return { checked: 0, created: 0 };
  }

  const sdIssues = await search(
    `project = ${config.sdProject} AND status = "${config.sdSentStatus}" ORDER BY updated ASC`,
    ["summary", "description", "issuelinks", "status"],
    config
  );
  let created = 0;

  for (const sdIssue of sdIssues) {
    if (getLinkedIssueKey(sdIssue, config.hwProject)) continue;

    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: config.hwProject },
          issuetype: { name: config.hwIssueType },
          summary: sdIssue.fields?.summary || `Hardware request for ${sdIssue.key}`,
          description: sdIssue.fields?.description ?? undefined,
        },
      }),
    });

    if (!response.ok) {
      console.log(`HW-SYNC: failed creating HW issue for ${sdIssue.key}: ${await response.text()}`);
      continue;
    }

    const createdIssue = await response.json();
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
      console.log(`HW-SYNC: created ${createdIssue.key} but linking to ${sdIssue.key} failed`);
      continue;
    }

    created += 1;
    if (config.commentsEnabled) {
      await addInternalComment(sdIssue.key, `Hardware ticket ${createdIssue.key} was created and linked automatically.`);
    }
  }

  return { checked: sdIssues.length, created };
}

export async function runHardwareSync() {
  console.log("HW-SYNC: starting hardware handover reconciliation");

  try {
    const config = await getDeliveryManagerConfig();
    const dispatch = await reconcileDispatchedHardware(config);
    const creation = await createMissingHardwareTickets(config);

    console.log(
      `HW-SYNC: complete; dispatched checked=${dispatch.checked}, repaired=${dispatch.repaired}, ` +
      `sent-to-hardware checked=${creation.checked}, created=${creation.created}`
    );
  } catch (error) {
    console.log(`HW-SYNC: failed: ${String(error)}`);
  }
}
