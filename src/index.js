import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";
const MAX_SEARCH_RESULTS = 100;
const MAX_TOTAL_ISSUES = 500;
const DELAY_MS = 5000;

const DEFAULT_CONFIG = {
  enabled: true,
  projectKey: "SD",
  minDaysSinceSent: 3,
  maxPerRun: 3,
  dhlBaseUrl: DHL_DEFAULT_URL,
  fields: {
    tracking: "customfield_10417",
    deliveryStatus: "customfield_11952",
    deliveryDate: "customfield_10434",
    signedFor: "customfield_10442",
    dateSent: "customfield_10433",
    lastDhlCheck: "customfield_14400",
    client: "customfield_11658"
  },
  clients: ["RYR - Ryanair", "RYS - Buzz", "LDA - Lauda "],
  workflowStatuses: {
    dispatched: "Dispatched to Customer",
    outForDelivery: "OUT FOR DELIVERY",
    awaitingCollection: "DELIVERY AWAITING COLLECTION",
    onHold: "DELIVERY ON HOLD",
    failed: "DELIVERY FAILED",
    resolved: "Resolved"
  },
  deliveryStatusValues: {
    delivered: "Delivered",
    returnedToSender: "Returned to Sender",
    deliveryFailed: "Delivery Attempted",
    awaitingCollection: "Awaiting Collection",
    onHold: "Exception / On Hold",
    customsDelay: "Customs Delay",
    outForDelivery: "Out for Delivery",
    inTransit: "In Transit",
    unknown: "Unknown"
  },
  comments: {
    enabled: true,
    outForDelivery: "📦 DHL update for {issueKey}: shipment {trackingNumber} is out for delivery.\n\nLatest DHL update: {dhlDescription}",
    awaitingCollection: "📦 DHL update for {issueKey}: shipment {trackingNumber} is awaiting collection.\n\nLatest DHL update: {dhlDescription}",
    onHold: "⚠️ DHL update for {issueKey}: shipment {trackingNumber} is on hold.\n\nLatest DHL update: {dhlDescription}",
    failed: "⚠️ DHL update for {issueKey}: delivery requires attention.\n\nLatest DHL update: {dhlDescription}",
    delivered: "📦 DHL Delivery Update (Automated)\n\nDelivered: {date}\nSigned for by: {signedFor}\nTracking number: {trackingNumber}"
  }
};

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    workflowStatuses: { ...DEFAULT_CONFIG.workflowStatuses, ...(saved.workflowStatuses || {}) },
    deliveryStatusValues: { ...DEFAULT_CONFIG.deliveryStatusValues, ...(saved.deliveryStatusValues || {}) },
    comments: { ...DEFAULT_CONFIG.comments, ...(saved.comments || {}) }
  };
}

async function getConfig() {
  const saved = await kvs.get(CONFIG_KEY);
  return mergeConfig(saved || {});
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function normalise(value) { return String(value ?? "").trim().toLowerCase(); }
function jqlString(value) { return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }

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
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values[key] ?? ""));
}

async function updateIssueFields(issueKey, fields) {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    console.log(`❌ Failed to update fields on ${issueKey}: ${await response.text()}`);
    return false;
  }
  return true;
}

async function addInternalComment(issueKey, text) {
  if (!text?.trim()) return true;
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ public: false, body: text })
  });
  if (!response.ok) {
    console.log(`⚠️ Failed to add internal comment to ${issueKey}: ${await response.text()}`);
    return false;
  }
  return true;
}

async function transitionToStatus(issueKey, currentStatusName, targetStatusName, resolutionName = null) {
  if (!targetStatusName || normalise(currentStatusName) === normalise(targetStatusName)) return false;

  const getResponse = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!getResponse.ok) {
    console.log(`❌ Could not retrieve transitions for ${issueKey}: ${await getResponse.text()}`);
    return false;
  }

  const data = await getResponse.json();
  const transitions = data.transitions ?? [];
  const match = transitions.find((transition) => normalise(transition.to?.name) === normalise(targetStatusName));

  if (!match) {
    console.log(`⚠️ ${issueKey}: no transition to "${targetStatusName}". Available: ${transitions.map((t) => t.to?.name).filter(Boolean).join(", ")}`);
    return false;
  }

  const payload = { transition: { id: match.id } };
  if (resolutionName) payload.fields = { resolution: { name: resolutionName } };

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.log(`❌ Failed transition ${issueKey} -> ${targetStatusName}: ${await response.text()}`);
    return false;
  }

  console.log(`✅ ${issueKey} transitioned to "${targetStatusName}" using transition ${match.id}`);
  return true;
}

async function getDHL(baseUrl, apiKey, trackingNumber) {
  const response = await api.fetch(`${baseUrl}?trackingNumber=${encodeURIComponent(trackingNumber)}`, {
    method: "GET",
    headers: { "DHL-API-Key": apiKey, Accept: "application/json" }
  });
  if (response.status === 429) return { rateLimited: true, retryAfter: response.headers.get("Retry-After") };
  if (!response.ok) return { error: true, status: response.status, body: await response.text() };
  return { ok: true, data: await response.json() };
}

function determineDhlState(shipment) {
  const latest = shipment?.events?.[0] || {};
  const currentText = `${normalise(shipment?.status?.description || shipment?.status?.status)} ${normalise(latest.description)}`;
  const includesAny = (phrases) => phrases.some((phrase) => currentText.includes(phrase));

  if (includesAny(["delivered"])) return "delivered";
  if (includesAny(["return to sender", "returned to sender", "returned to shipper", "shipment returned"])) return "returnedToSender";
  if (includesAny(["awaiting collection", "collection by the consignee", "ready for collection"])) return "awaitingCollection";
  if (includesAny(["delivery attempt could not be completed", "delivery attempted but no response", "recipient not home", "consignee not available", "delivery failed"])) return "deliveryFailed";
  if (includesAny(["customs", "clearance event"])) return "customsDelay";
  if (includesAny(["on hold", "held at", "exception", "further consignee information needed"])) return "onHold";
  if (includesAny(["out for delivery", "out with courier", "with courier for delivery", "with delivery courier", "scheduled for delivery"])) return "outForDelivery";
  if (includesAny(["transit", "processed", "departed", "sorted", "facility", "picked up", "forwarded"])) return "inTransit";
  return "unknown";
}

function stateToWorkflowStatus(state, config) {
  switch (state) {
    case "outForDelivery": return config.workflowStatuses.outForDelivery;
    case "awaitingCollection": return config.workflowStatuses.awaitingCollection;
    case "onHold":
    case "customsDelay": return config.workflowStatuses.onHold;
    case "deliveryFailed":
    case "returnedToSender": return config.workflowStatuses.failed;
    case "delivered": return config.workflowStatuses.resolved;
    default: return null;
  }
}

function stateToDeliveryStatus(state, config) {
  return config.deliveryStatusValues[state] || config.deliveryStatusValues.unknown;
}

function stateToCommentKey(state) {
  if (state === "delivered") return "delivered";
  if (state === "outForDelivery") return "outForDelivery";
  if (state === "awaitingCollection") return "awaitingCollection";
  if (state === "onHold" || state === "customsDelay") return "onHold";
  if (state === "deliveryFailed" || state === "returnedToSender") return "failed";
  return null;
}

async function searchEligibleIssues(config) {
  const fields = config.fields;
  const activeStatuses = [config.workflowStatuses.dispatched, config.workflowStatuses.outForDelivery, config.workflowStatuses.awaitingCollection, config.workflowStatuses.onHold].filter(Boolean);
  if (!activeStatuses.length) return [];

  let jql = `${jqlString(fields.tracking)} IS NOT EMPTY AND project = ${jqlString(config.projectKey)} AND status IN (${activeStatuses.map(jqlString).join(", ")}) `;

  if (fields.client && config.clients?.length) {
    jql += `AND ${jqlString(fields.client)} IN (${config.clients.map(jqlString).join(", ")}) `;
  }

  jql += `AND (${jqlString(fields.deliveryStatus)} IS EMPTY OR ${jqlString(fields.deliveryStatus)} != ${jqlString(config.deliveryStatusValues.delivered)})`;

  const fieldsParam = [fields.tracking, fields.deliveryStatus, fields.deliveryDate, fields.signedFor, fields.dateSent, fields.lastDhlCheck, fields.client, "status"].filter(Boolean).join(",");
  console.log("📥 JQL:", jql);

  const allIssues = [];
  let nextPageToken = null;
  do {
    const response = nextPageToken
      ? await api.asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}&nextPageToken=${nextPageToken}`, { method: "GET", headers: { Accept: "application/json" } })
      : await api.asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}`, { method: "GET", headers: { Accept: "application/json" } });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    allIssues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken ?? null;
  } while (nextPageToken && allIssues.length < MAX_TOTAL_ISSUES);

  return allIssues.slice(0, MAX_TOTAL_ISSUES);
}

export async function run() {
  console.log("DHL Tracking App v6 - configurable Marketplace build");
  const config = await getConfig();

  if (!config.enabled) {
    console.log("ℹ️ DHL Tracking is disabled in app settings.");
    return;
  }

  const apiKey = await kvs.getSecret(DHL_API_KEY_SECRET);
  if (!apiKey) {
    console.log("⚠️ DHL API key is not configured. Open Jira Administration > Apps > DHL Tracking > Configure.");
    return;
  }

  let issues;
  try { issues = await searchEligibleIssues(config); }
  catch (error) {
    console.log(`❌ Jira search failed: ${String(error)}`);
    return;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(config.minDaysSinceSent || 0));

  issues = issues.filter((issue) => {
    const sent = parseJiraDate(issue.fields[config.fields.dateSent]);
    return sent && sent <= cutoff;
  });

  issues.sort((a, b) => {
    const aLast = a.fields[config.fields.lastDhlCheck];
    const bLast = b.fields[config.fields.lastDhlCheck];
    if (!aLast && !bLast) return parseJiraDate(a.fields[config.fields.dateSent]) - parseJiraDate(b.fields[config.fields.dateSent]);
    if (!aLast) return -1;
    if (!bLast) return 1;
    return new Date(aLast) - new Date(bLast);
  });

  const toProcess = issues.slice(0, Number(config.maxPerRun || 3));
  console.log(`⚙️ Processing ${toProcess.length} issue(s): ${toProcess.map((i) => i.key).join(", ")}`);

  for (const issue of toProcess) {
    const issueKey = issue.key;
    const trackingNumber = issue.fields[config.fields.tracking];
    const currentStatus = issue.fields.status?.name || "";
    if (!trackingNumber) continue;

    await sleep(DELAY_MS);
    const dhl = await getDHL(config.dhlBaseUrl || DHL_DEFAULT_URL, apiKey, trackingNumber);

    if (dhl.rateLimited) {
      console.log(`⏱️ DHL rate limit reached on ${issueKey}. Retry-After: ${dhl.retryAfter || "unknown"}`);
      break;
    }

    if (!dhl.ok) {
      console.log(`⚠️ DHL request failed for ${issueKey}: ${dhl.status || ""} ${dhl.body || ""}`);
      continue;
    }

    await updateIssueFields(issueKey, { [config.fields.lastDhlCheck]: new Date().toISOString() });

    const shipment = dhl.data?.shipments?.[0];
    if (!shipment) {
      console.log(`⚠️ No DHL shipment returned for ${issueKey}`);
      continue;
    }

    const latest = shipment?.events?.[0] || {};
    const latestDescription = latest.description || shipment?.status?.description || "No DHL description returned";
    const state = determineDhlState(shipment);
    const deliveryStatus = stateToDeliveryStatus(state, config);
    const targetWorkflowStatus = stateToWorkflowStatus(state, config);

    console.log(`📦 ${issueKey}: DHL state=${state}, Jira target=${targetWorkflowStatus || "no workflow change"}`);

    const fieldUpdate = {};
    if (deliveryStatus && currentDropdownValue(issue.fields[config.fields.deliveryStatus]) !== deliveryStatus) {
      fieldUpdate[config.fields.deliveryStatus] = { value: deliveryStatus };
    }

    let deliveredDate = "";
    let signedFor = "";

    if (state === "delivered") {
      deliveredDate = latest?.timestamp?.split("T")[0] || "";
      signedFor = shipment?.proofOfDelivery?.recipientName || latest?.receiverName || latest?.signature || "Unknown";
      if (deliveredDate) fieldUpdate[config.fields.deliveryDate] = deliveredDate;
      fieldUpdate[config.fields.signedFor] = signedFor;
    }

    if (Object.keys(fieldUpdate).length) await updateIssueFields(issueKey, fieldUpdate);

    let transitioned = false;
    if (targetWorkflowStatus) {
      transitioned = await transitionToStatus(issueKey, currentStatus, targetWorkflowStatus, state === "delivered" ? "Done" : null);
    }

    if (transitioned && config.comments?.enabled) {
      const commentKey = stateToCommentKey(state);
      const template = commentKey ? config.comments[commentKey] : "";
      const comment = renderTemplate(template, {
        issueKey,
        trackingNumber,
        deliveryStatus,
        dhlDescription: latestDescription,
        date: deliveredDate,
        signedFor
      });
      await addInternalComment(issueKey, comment);
    }
  }

  console.log("✅ DHL Tracking scheduler complete");
}
