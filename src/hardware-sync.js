import api, { route } from "@forge/api";
import {
  normalise,
  getLinkedIssueKey,
  buildDispatchRepair,
} from "./hardware-core.mjs";

const CONFIG = {
  sdProject: process.env.HW_SD_PROJECT_KEY || "SD",
  hwProject: process.env.HW_PROJECT_KEY || "HW",
  sdSentStatus: process.env.HW_SD_SENT_STATUS || "Sent to Hardware",
  hwDispatchedStatus: process.env.HW_DISPATCHED_STATUS || "Dispatched",
  sdDispatchedStatus: process.env.HW_SD_DISPATCHED_STATUS || "Dispatched",
  trackingField: process.env.HW_TRACKING_FIELD || "customfield_10417",
  dateSentField: process.env.HW_DATE_SENT_FIELD || "customfield_10433",
  createEnabled: normalise(process.env.HW_CREATE_ENABLED) === "true",
  hwIssueType: process.env.HW_ISSUE_TYPE || "",
  maxResults: Number(process.env.HW_SYNC_MAX_RESULTS || 100),
};

async function search(jql, fields) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${CONFIG.maxResults}&fields=${fields.join(",")}`,
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

async function reconcileDispatchedHardware() {
  const fields = [
    CONFIG.trackingField,
    CONFIG.dateSentField,
    "issuelinks",
    "status",
    "summary",
  ];

  const jql =
    `project = ${CONFIG.hwProject} ` +
    `AND status = "${CONFIG.hwDispatchedStatus}" ` +
    `AND "Tracking Number" IS NOT EMPTY ` +
    `AND "Date Sent[Date]" IS NOT EMPTY ` +
    `ORDER BY updated ASC`;

  const hwIssues = await search(jql, fields);
  let repaired = 0;

  for (const hwIssue of hwIssues) {
    const sdKey = getLinkedIssueKey(hwIssue, CONFIG.sdProject);
    if (!sdKey) {
      console.log(`HW-SYNC: ${hwIssue.key} has no linked ${CONFIG.sdProject} issue`);
      continue;
    }

    const sdIssue = await getIssue(sdKey, [
      CONFIG.trackingField,
      CONFIG.dateSentField,
      "status",
    ]);
    if (!sdIssue) continue;

    const repair = buildDispatchRepair(hwIssue, sdIssue, CONFIG);
    if (!repair.ready) continue;

    const fieldsOk = await updateFields(sdKey, repair.fields);
    let transitionOk = true;
    if (repair.transition) {
      transitionOk = await transitionTo(sdKey, CONFIG.sdDispatchedStatus);
    }

    if (
      fieldsOk &&
      transitionOk &&
      (Object.keys(repair.fields).length || repair.transition)
    ) {
      repaired += 1;
      await addInternalComment(
        sdKey,
        `Hardware dispatch synchronised automatically from ${hwIssue.key}. Tracking Number and Date Sent were verified and the SD workflow was reconciled.`
      );
      console.log(`HW-SYNC: repaired ${hwIssue.key} -> ${sdKey}`);
    }
  }

  return { checked: hwIssues.length, repaired };
}

async function createMissingHardwareTickets() {
  if (!CONFIG.createEnabled) {
    console.log(
      "HW-SYNC: automatic HW ticket creation is disabled until mapping is verified"
    );
    return { checked: 0, created: 0 };
  }

  if (!CONFIG.hwIssueType) {
    console.log(
      "HW-SYNC: HW_CREATE_ENABLED=true but HW_ISSUE_TYPE is not configured"
    );
    return { checked: 0, created: 0 };
  }

  const sdIssues = await search(
    `project = ${CONFIG.sdProject} AND status = "${CONFIG.sdSentStatus}" ORDER BY updated ASC`,
    ["summary", "description", "issuelinks", "status"]
  );
  let created = 0;

  for (const sdIssue of sdIssues) {
    if (getLinkedIssueKey(sdIssue, CONFIG.hwProject)) continue;

    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: CONFIG.hwProject },
          issuetype: { name: CONFIG.hwIssueType },
          summary:
            sdIssue.fields?.summary || `Hardware request for ${sdIssue.key}`,
          description: sdIssue.fields?.description ?? undefined,
        },
      }),
    });

    if (!response.ok) {
      console.log(
        `HW-SYNC: failed creating HW issue for ${sdIssue.key}: ${await response.text()}`
      );
      continue;
    }

    const createdIssue = await response.json();
    const linkResponse = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: { name: process.env.HW_LINK_TYPE || "Relates" },
        inwardIssue: { key: sdIssue.key },
        outwardIssue: { key: createdIssue.key },
      }),
    });

    if (!linkResponse.ok) {
      console.log(
        `HW-SYNC: created ${createdIssue.key} but linking to ${sdIssue.key} failed`
      );
      continue;
    }

    created += 1;
    await addInternalComment(
      sdIssue.key,
      `Hardware ticket ${createdIssue.key} was created and linked automatically.`
    );
  }

  return { checked: sdIssues.length, created };
}

export async function runHardwareSync() {
  console.log("HW-SYNC: starting hardware handover reconciliation");

  try {
    const dispatch = await reconcileDispatchedHardware();
    const creation = await createMissingHardwareTickets();

    console.log(
      `HW-SYNC: complete; dispatched checked=${dispatch.checked}, ` +
      `repaired=${dispatch.repaired}, sent-to-hardware checked=${creation.checked}, ` +
      `created=${creation.created}`
    );
  } catch (error) {
    console.log(`HW-SYNC: failed: ${String(error)}`);
  }
}
