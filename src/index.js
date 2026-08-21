import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const TERMINAL_ISSUES_KEY = "dhl-terminal-issues";
const ACTIVITY_LOG_KEY = "dhl-activity-log";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";
const MAX_SEARCH_RESULTS = 100;
const MAX_TOTAL_ISSUES = 500;
const MAX_ACTIVITY_LOG_ENTRIES = 100;
const DELAY_MS = 5000;

const STANDARD_DHL_CATEGORIES = [
  { category: "pickedUp", label: "Picked Up", terminal: false },
  { category: "inTransit", label: "In Transit", terminal: false },
  { category: "outForDelivery", label: "Out for Delivery", terminal: false },
  { category: "awaitingCollection", label: "Awaiting Collection", terminal: false },
  { category: "onHold", label: "On Hold / Exception", terminal: false },
  { category: "customsDelay", label: "Customs / Clearance Delay", terminal: false },
  { category: "deliveryFailed", label: "Delivery Attempted / Failed", terminal: false },
  { category: "returnedToSender", label: "Returned to Sender", terminal: true },
  { category: "delivered", label: "Delivered", terminal: true },
  { category: "unknown", label: "Unknown / Other", terminal: false }
];

const DEFAULT_CONFIG = {
  enabled: true,
  projectKey: "SD",
  minDaysSinceSent: 0,
  maxPerRun: 3,
  dhlBaseUrl: DHL_DEFAULT_URL,
  fields: {
    tracking: "",
    deliveryStatus: "",
    deliveryDate: "",
    signedFor: "",
    dateSent: "",
    lastDhlCheck: "",
    client: ""
  },
  clients: [],
  additionalFieldMappings: [],
  statusMappings: [],
  comments: { enabled: true }
};

let pendingActivity = [];

function categoryRows(savedRows = []) {
  return STANDARD_DHL_CATEGORIES.map((standard) => {
    const existing = (savedRows || []).find((row) =>
      row?.category === standard.category ||
      String(row?.dhlText || "").trim().toLowerCase() === standard.label.toLowerCase()
    ) || {};

    return {
      category: standard.category,
      label: standard.label,
      jiraStatus: existing.jiraStatus || "",
      deliveryStatus: existing.deliveryStatus || "",
      enabled: existing.enabled !== false,
      terminal: existing.terminal ?? standard.terminal,
      commentTemplate: existing.commentTemplate || ""
    };
  });
}

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    additionalFieldMappings: Array.isArray(saved.additionalFieldMappings)
      ? saved.additionalFieldMappings
      : [],
    statusMappings: categoryRows(saved.statusMappings),
    comments: { ...DEFAULT_CONFIG.comments, ...(saved.comments || {}) }
  };
}

async function getConfig() {
  return mergeConfig((await kvs.get(CONFIG_KEY)) || {});
}

async function activity(level, action, details = "", issueKey = "") {
  pendingActivity.unshift({
    timestamp: new Date().toISOString(),
    level,
    action,
    details,
    issueKey
  });
}

async function flushActivity() {
  if (pendingActivity.length === 0) return;
  try {
    const existing = (await kvs.get(ACTIVITY_LOG_KEY)) || [];
    const combined = [...pendingActivity, ...existing].slice(0, MAX_ACTIVITY_LOG_ENTRIES);
    await kvs.set(ACTIVITY_LOG_KEY, combined);
    pendingActivity = [];
  } catch (error) {
    console.log(`Activity log write failed: ${String(error)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function jqlString(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseJiraDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function currentDropdownValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.value ?? null;
}

function renderTemplate(template, values) {
  return String(template || "").replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_, key) => String(values[key] ?? "")
  );
}

function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((value, part) => {
    if (value === null || value === undefined) return undefined;
    return value[part];
  }, obj);
}

function determineCategory(shipment) {
  const latest = shipment?.events?.[0] || {};
  const text = normalise(
    `${shipment?.status?.description || ""} ${shipment?.status?.status || ""} ${latest?.description || ""} ${latest?.status || ""}`
  );
  const has = (...phrases) => phrases.some((phrase) => text.includes(phrase));

  if (has("delivered")) return "delivered";
  if (has("return to sender", "returned to sender", "returned to shipper", "shipment returned")) return "returnedToSender";
  if (has("awaiting collection", "collection by the consignee", "ready for collection")) return "awaitingCollection";
  if (has("delivery attempt could not be completed", "delivery attempted but no response", "recipient not home", "consignee not available", "delivery failed", "delivery attempted")) return "deliveryFailed";
  if (has("customs", "clearance event", "clearance delay")) return "customsDelay";
  if (has("on hold", "held at", "exception", "further consignee information needed")) return "onHold";
  if (has("out for delivery", "out with courier", "with courier for delivery", "with delivery courier", "scheduled for delivery")) return "outForDelivery";
  if (has("shipment picked up", "picked up")) return "pickedUp";
  if (has("transit", "processed", "departed", "sorted", "facility", "forwarded", "arrived")) return "inTransit";
  return "unknown";
}

function configuredMapping(category, config) {
  return (config.statusMappings || []).find(
    (row) => row?.category === category && row?.enabled !== false
  ) || null;
}

async function updateIssueFields(issueKey, fields) {
  if (!fields || Object.keys(fields).length === 0) return true;

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fields })
  });

  if (!response.ok) {
    const body = await response.text();
    console.log(`❌ Failed to update fields on ${issueKey}: ${body}`);
    await activity("error", "Jira field update failed", body.slice(0, 400), issueKey);
    return false;
  }

  return true;
}

async function addInternalComment(issueKey, text) {
  if (!text?.trim()) return true;

  const response = await api.asApp().requestJira(
    route`/rest/servicedeskapi/request/${issueKey}/comment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ public: false, body: text })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.log(`⚠️ Failed to add internal comment to ${issueKey}: ${body}`);
    await activity("warning", "Internal comment failed", body.slice(0, 400), issueKey);
    return false;
  }

  await activity("info", "Internal comment added", "DHL status comment added to Jira.", issueKey);
  return true;
}

async function transitionToStatus(issueKey, currentStatusName, targetStatusName, resolutionName = null) {
  if (!targetStatusName || normalise(currentStatusName) === normalise(targetStatusName)) {
    return false;
  }

  const getResponse = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/transitions`,
    { method: "GET", headers: { Accept: "application/json" } }
  );

  if (!getResponse.ok) {
    const body = await getResponse.text();
    await activity("error", "Could not read Jira transitions", body.slice(0, 400), issueKey);
    return false;
  }

  const data = await getResponse.json();
  const transitions = data.transitions ?? [];
  const match = transitions.find(
    (transition) => normalise(transition.to?.name) === normalise(targetStatusName)
  );

  if (!match) {
    const available = transitions.map((item) => item.to?.name).filter(Boolean).join(", ");
    console.log(`⚠️ ${issueKey} cannot transition to "${targetStatusName}". Available: ${available}`);
    await activity(
      "warning",
      "Workflow transition unavailable",
      `Wanted ${targetStatusName}. Available: ${available}`,
      issueKey
    );
    return false;
  }

  const payload = { transition: { id: match.id } };
  if (resolutionName) payload.fields = { resolution: { name: resolutionName } };

  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    await activity("error", "Workflow transition failed", body.slice(0, 400), issueKey);
    return false;
  }

  console.log(`✅ ${issueKey} transitioned to "${targetStatusName}"`);
  await activity("info", "Jira status changed", `${currentStatusName} → ${targetStatusName}`, issueKey);
  return true;
}

async function getDHL(baseUrl, apiKey, trackingNumber) {
  const response = await api.fetch(
    `${baseUrl}?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    {
      method: "GET",
      headers: { "DHL-API-Key": apiKey, Accept: "application/json" }
    }
  );

  if (response.status === 429) {
    return { rateLimited: true, retryAfter: response.headers.get("Retry-After") };
  }
  if (!response.ok) {
    return { error: true, status: response.status, body: await response.text() };
  }
  return { ok: true, data: await response.json() };
}

async function getTerminalIssueKeys() {
  return new Set((await kvs.get(TERMINAL_ISSUES_KEY)) || []);
}

async function markTerminalIssue(issueKey) {
  const current = await getTerminalIssueKeys();
  if (current.has(issueKey)) return;
  current.add(issueKey);
  await kvs.set(TERMINAL_ISSUES_KEY, [...current].slice(-5000));
}

async function searchEligibleIssues(config) {
  const fields = config.fields || {};
  if (!fields.tracking) throw new Error("Tracking number field is not configured.");

  let jql = `${jqlString(fields.tracking)} IS NOT EMPTY AND project = ${jqlString(config.projectKey)}`;

  if (fields.client && config.clients?.length) {
    jql += ` AND ${jqlString(fields.client)} IN (${config.clients.map(jqlString).join(", ")})`;
  }

  const terminalDeliveryValues = (config.statusMappings || [])
    .filter((mapping) => mapping?.terminal && mapping?.deliveryStatus)
    .map((mapping) => mapping.deliveryStatus);

  if (fields.deliveryStatus && terminalDeliveryValues.length) {
    jql += ` AND (${jqlString(fields.deliveryStatus)} IS EMPTY OR ${jqlString(fields.deliveryStatus)} NOT IN (${terminalDeliveryValues.map(jqlString).join(", ")}))`;
  }

  const fieldsParam = [
    fields.tracking,
    fields.deliveryStatus,
    fields.deliveryDate,
    fields.signedFor,
    fields.dateSent,
    fields.lastDhlCheck,
    fields.client,
    "status"
  ].filter(Boolean).join(",");

  console.log("📥 JQL:", jql);

  const allIssues = [];
  let nextPageToken = null;

  do {
    const response = nextPageToken
      ? await api.asApp().requestJira(
          route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}&nextPageToken=${nextPageToken}`,
          { method: "GET", headers: { Accept: "application/json" } }
        )
      : await api.asApp().requestJira(
          route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    allIssues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken ?? null;
  } while (nextPageToken && allIssues.length < MAX_TOTAL_ISSUES);

  const terminalIssueKeys = await getTerminalIssueKeys();
  return allIssues
    .filter((issue) => !terminalIssueKeys.has(issue.key))
    .slice(0, MAX_TOTAL_ISSUES);
}

export async function run() {
  pendingActivity = [];
  console.log("DHL Tracking App v6.3 - storage-optimised activity logging");

  const config = await getConfig();
  if (!config.enabled) {
    return;
  }

  const apiKey = await kvs.getSecret(DHL_API_KEY_SECRET);
  if (!apiKey) {
    console.log("⚠️ DHL API key is not configured.");
    await activity("warning", "Scheduler stopped", "DHL API key is not configured.");
    await flushActivity();
    return;
  }

  let issues;
  try {
    issues = await searchEligibleIssues(config);
  } catch (error) {
    console.log(`❌ Jira search failed: ${String(error)}`);
    await activity("error", "Jira search failed", String(error).slice(0, 500));
    await flushActivity();
    return;
  }

  if (config.fields?.dateSent && Number(config.minDaysSinceSent || 0) > 0) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - Number(config.minDaysSinceSent || 0));
    issues = issues.filter((issue) => {
      const sent = parseJiraDate(issue.fields[config.fields.dateSent]);
      return sent && sent <= cutoff;
    });
  }

  issues.sort((a, b) => {
    const lastField = config.fields?.lastDhlCheck;
    if (!lastField) return 0;
    const aLast = a.fields[lastField];
    const bLast = b.fields[lastField];
    if (!aLast && !bLast) return 0;
    if (!aLast) return -1;
    if (!bLast) return 1;
    return new Date(aLast) - new Date(bLast);
  });

  const toProcess = issues.slice(0, Number(config.maxPerRun || 3));
  console.log(`⚙️ Processing ${toProcess.length} issue(s): ${toProcess.map((issue) => issue.key).join(", ")}`);

  for (const issue of toProcess) {
    const issueKey = issue.key;
    const trackingNumber = issue.fields[config.fields.tracking];
    const currentStatus = issue.fields.status?.name || "";
    if (!trackingNumber) continue;

    await sleep(DELAY_MS);
    console.log(`📦 Checking ${issueKey}`);

    const dhl = await getDHL(config.dhlBaseUrl || DHL_DEFAULT_URL, apiKey, trackingNumber);

    if (dhl.rateLimited) {
      await activity("warning", "DHL rate limit reached", `Retry-After: ${dhl.retryAfter || "unknown"}`);
      break;
    }

    if (!dhl.ok) {
      await activity(
        "error",
        "DHL tracking request failed",
        `HTTP ${dhl.status || "unknown"}: ${String(dhl.body || "").slice(0, 300)}`,
        issueKey
      );
      continue;
    }

    const shipment = dhl.data?.shipments?.[0];
    if (!shipment) {
      await activity("warning", "No DHL shipment returned", "DHL returned no matching shipment.", issueKey);
      continue;
    }

    const category = determineCategory(shipment);
    const mapping = configuredMapping(category, config);
    const latest = shipment?.events?.[0] || {};
    const latestDescription = latest?.description || shipment?.status?.description || "No DHL description returned";
    const latestCode = latest?.statusCode || latest?.code || shipment?.status?.statusCode || "";
    const categoryLabel = STANDARD_DHL_CATEGORIES.find((item) => item.category === category)?.label || category;

    console.log(`📬 ${issueKey}: ${categoryLabel} — ${latestDescription}`);

    const fieldUpdate = {};
    if (config.fields?.lastDhlCheck) {
      fieldUpdate[config.fields.lastDhlCheck] = new Date().toISOString();
    }

    let deliveredDate = "";
    let signedFor = "";
    let deliveryStatusChanged = false;

    if (mapping?.deliveryStatus && config.fields?.deliveryStatus) {
      const currentValue = currentDropdownValue(issue.fields[config.fields.deliveryStatus]);
      if (currentValue !== mapping.deliveryStatus) {
        fieldUpdate[config.fields.deliveryStatus] = { value: mapping.deliveryStatus };
        deliveryStatusChanged = true;
      }
    }

    if (category === "delivered") {
      deliveredDate = String(latest?.timestamp || shipment?.status?.timestamp || "").split("T")[0];
      signedFor =
        shipment?.proofOfDelivery?.recipientName ||
        latest?.receiverName ||
        latest?.signature ||
        "Unknown";

      if (config.fields?.deliveryDate && deliveredDate) {
        fieldUpdate[config.fields.deliveryDate] = deliveredDate;
      }
      if (config.fields?.signedFor) {
        fieldUpdate[config.fields.signedFor] = signedFor;
      }
    }

    for (const extra of config.additionalFieldMappings || []) {
      if (!extra?.jiraFieldId || !extra?.dhlPath) continue;
      const value = getPath(shipment, extra.dhlPath);
      if (value === undefined || value === null || typeof value === "object") continue;
      fieldUpdate[extra.jiraFieldId] = String(value);
    }

    const fieldsUpdated = await updateIssueFields(issueKey, fieldUpdate);
    const meaningfulFieldCount = Object.keys(fieldUpdate).filter(
      (fieldId) => fieldId !== config.fields?.lastDhlCheck
    ).length;
    if (fieldsUpdated && meaningfulFieldCount > 0) {
      await activity(
        "info",
        "Jira fields updated",
        `${categoryLabel}: ${meaningfulFieldCount} meaningful field(s) updated. ${latestDescription}`,
        issueKey
      );
    }

    let transitioned = false;
    if (mapping?.jiraStatus) {
      transitioned = await transitionToStatus(
        issueKey,
        currentStatus,
        mapping.jiraStatus,
        category === "delivered" ? "Done" : null
      );
    }

    if (config.comments?.enabled && mapping?.commentTemplate && (transitioned || deliveryStatusChanged)) {
      const comment = renderTemplate(mapping.commentTemplate, {
        issueKey,
        trackingNumber,
        dhlCategory: categoryLabel,
        dhlDescription: latestDescription,
        dhlCode: latestCode,
        deliveryStatus: mapping?.deliveryStatus || "",
        date: deliveredDate,
        signedFor
      });
      await addInternalComment(issueKey, comment);
    }

    if (mapping?.terminal) {
      await markTerminalIssue(issueKey);
      await activity("info", "Tracking completed", `${categoryLabel} is configured as a terminal DHL state.`, issueKey);
    }

    if (!mapping) {
      await activity("warning", "No mapping configured", `${categoryLabel} has no enabled mapping.`, issueKey);
    }
  }

  console.log("✅ DHL Tracking v6.3 scheduler complete");
  if (pendingActivity.length > 0) {
    await activity("info", "Scheduler complete", `${toProcess.length} issue(s) checked; notable activity recorded.`);
  }
  await flushActivity();
}