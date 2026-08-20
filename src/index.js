import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";

const CONFIG_KEY = "dhl-tracking-config";
const OBSERVED_STATUS_KEY = "dhl-observed-statuses";
const TERMINAL_ISSUES_KEY = "dhl-terminal-issues";
const DHL_API_KEY_SECRET = "dhl-api-key";
const DHL_DEFAULT_URL = "https://api-eu.dhl.com/track/shipments";
const MAX_SEARCH_RESULTS = 100;
const MAX_TOTAL_ISSUES = 500;
const DELAY_MS = 5000;

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
  legacyFallbackEnabled: true,
  workflowStatuses: {},
  deliveryStatusValues: {},
  comments: { enabled: true }
};

function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    fields: { ...DEFAULT_CONFIG.fields, ...(saved.fields || {}) },
    additionalFieldMappings: Array.isArray(saved.additionalFieldMappings) ? saved.additionalFieldMappings : [],
    statusMappings: Array.isArray(saved.statusMappings) ? saved.statusMappings : [],
    workflowStatuses: { ...(saved.workflowStatuses || {}) },
    deliveryStatusValues: { ...(saved.deliveryStatusValues || {}) },
    comments: { ...DEFAULT_CONFIG.comments, ...(saved.comments || {}) }
  };
}

async function getConfig() {
  return mergeConfig((await kvs.get(CONFIG_KEY)) || {});
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
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values[key] ?? ""));
}

function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((value, part) => {
    if (value === null || value === undefined) return undefined;
    return value[part];
  }, obj);
}

function extractObservedStatuses(shipment) {
  const found = [];
  const add = (description, code = "", status = "") => {
    const text = String(description || "").trim();
    if (!text) return;
    found.push({
      key: `${String(code || "").trim()}|${text.toLowerCase()}`,
      code: String(code || "").trim(),
      description: text,
      status: String(status || "").trim()
    });
  };

  add(shipment?.status?.description, shipment?.status?.statusCode, shipment?.status?.status);
  for (const event of shipment?.events || []) {
    add(event?.description, event?.statusCode || event?.code, event?.status);
  }
  return found;
}

async function recordObservedStatuses(shipment) {
  const existing = (await kvs.get(OBSERVED_STATUS_KEY)) || [];
  const byKey = new Map(existing.map((item) => [item.key, item]));
  const now = new Date().toISOString();
  for (const item of extractObservedStatuses(shipment)) {
    const previous = byKey.get(item.key) || {};
    byKey.set(item.key, {
      ...previous,
      ...item,
      firstSeen: previous.firstSeen || now,
      lastSeen: now
    });
  }
  await kvs.set(
    OBSERVED_STATUS_KEY,
    [...byKey.values()].sort((a, b) => a.description.localeCompare(b.description)).slice(0, 500)
  );
}

async function updateIssueFields(issueKey, fields) {
  if (!fields || Object.keys(fields).length === 0) return true;
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
    console.log(`⚠️ ${issueKey} cannot transition to "${targetStatusName}". Available destinations: ${transitions.map((t) => t.to?.name).filter(Boolean).join(", ")}`);
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

  if (response.status === 429) {
    return { rateLimited: true, retryAfter: response.headers.get("Retry-After") };
  }
  if (!response.ok) {
    return { error: true, status: response.status, body: await response.text() };
  }
  return { ok: true, data: await response.json() };
}

function determineLegacyState(shipment) {
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

function legacyMapping(state, config) {
  const workflow = config.workflowStatuses || {};
  const delivery = config.deliveryStatusValues || {};
  const comments = config.comments || {};

  const result = {
    source: "legacy",
    jiraStatus: "",
    deliveryStatus: delivery[state] || delivery.unknown || "",
    commentTemplate: "",
    terminal: false,
    setResolution: ""
  };

  if (state === "outForDelivery") {
    result.jiraStatus = workflow.outForDelivery || "";
    result.commentTemplate = comments.outForDelivery || "";
  } else if (state === "awaitingCollection") {
    result.jiraStatus = workflow.awaitingCollection || "";
    result.commentTemplate = comments.awaitingCollection || "";
  } else if (state === "onHold" || state === "customsDelay") {
    result.jiraStatus = workflow.onHold || "";
    result.commentTemplate = comments.onHold || "";
  } else if (state === "deliveryFailed" || state === "returnedToSender") {
    result.jiraStatus = workflow.failed || "";
    result.commentTemplate = comments.failed || "";
    result.terminal = true;
  } else if (state === "delivered") {
    result.jiraStatus = workflow.resolved || "";
    result.commentTemplate = comments.delivered || "";
    result.terminal = true;
    result.setResolution = "Done";
  }

  return result;
}

function resolveConfiguredMapping(shipment, config) {
  const latest = shipment?.events?.[0] || {};
  const candidates = [
    {
      text: String(latest?.description || "").trim(),
      code: String(latest?.statusCode || latest?.code || "").trim()
    },
    {
      text: String(shipment?.status?.description || "").trim(),
      code: String(shipment?.status?.statusCode || "").trim()
    }
  ].filter((candidate) => candidate.text);

  const mappings = (config.statusMappings || []).filter((mapping) => mapping?.enabled !== false && mapping?.dhlText);

  for (const candidate of candidates) {
    const match = mappings.find((mapping) => {
      const textMatches = normalise(candidate.text).includes(normalise(mapping.dhlText));
      const codeMatches = !String(mapping.dhlCode || "").trim() || normalise(candidate.code) === normalise(mapping.dhlCode);
      return textMatches && codeMatches;
    });
    if (match) {
      return {
        ...match,
        source: "configured",
        matchedDescription: candidate.text,
        matchedCode: candidate.code,
        terminal: Boolean(match.terminal)
      };
    }
  }

  return null;
}

async function getTerminalIssueKeys() {
  return new Set((await kvs.get(TERMINAL_ISSUES_KEY)) || []);
}

async function markTerminalIssue(issueKey) {
  const current = await getTerminalIssueKeys();
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
      ? await api.asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}&nextPageToken=${nextPageToken}`, { method: "GET", headers: { Accept: "application/json" } })
      : await api.asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}`, { method: "GET", headers: { Accept: "application/json" } });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    allIssues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken ?? null;
  } while (nextPageToken && allIssues.length < MAX_TOTAL_ISSUES);

  const terminalIssueKeys = await getTerminalIssueKeys();
  return allIssues.filter((issue) => !terminalIssueKeys.has(issue.key)).slice(0, MAX_TOTAL_ISSUES);
}

export async function run() {
  console.log("DHL Tracking App v6.1 - dynamic DHL/Jira mapping build");

  const config = await getConfig();
  if (!config.enabled) {
    console.log("ℹ️ DHL Tracking is disabled in app settings.");
    return;
  }

  const apiKey = await kvs.getSecret(DHL_API_KEY_SECRET);
  if (!apiKey) {
    console.log("⚠️ DHL API key is not configured. Open DHL Tracking > Configure.");
    return;
  }

  let issues;
  try {
    issues = await searchEligibleIssues(config);
  } catch (error) {
    console.log(`❌ Jira search failed: ${String(error)}`);
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
    console.log(`📦 Checking ${issueKey}: ${trackingNumber}`);

    const dhl = await getDHL(config.dhlBaseUrl || DHL_DEFAULT_URL, apiKey, trackingNumber);

    if (dhl.rateLimited) {
      console.log(`⏱️ DHL rate limit reached on ${issueKey}. Retry-After: ${dhl.retryAfter || "unknown"}`);
      break;
    }

    if (!dhl.ok) {
      console.log(`⚠️ DHL request failed for ${issueKey}: ${dhl.status || ""} ${dhl.body || ""}`);
      continue;
    }

    const shipment = dhl.data?.shipments?.[0];
    if (!shipment) {
      console.log(`⚠️ No DHL shipment returned for ${issueKey}`);
      continue;
    }

    await recordObservedStatuses(shipment);

    const latest = shipment?.events?.[0] || {};
    const latestDescription = latest?.description || shipment?.status?.description || "No DHL description returned";
    const latestCode = latest?.statusCode || latest?.code || shipment?.status?.statusCode || "";

    let mapping = resolveConfiguredMapping(shipment, config);
    if (!mapping && config.legacyFallbackEnabled) {
      const legacyState = determineLegacyState(shipment);
      mapping = legacyMapping(legacyState, config);
      mapping.matchedDescription = latestDescription;
      mapping.matchedCode = latestCode;
    }

    console.log(`📬 ${issueKey} DHL current event: ${latestDescription}${latestCode ? ` (${latestCode})` : ""}`);

    const fieldUpdate = {};
    const nowIso = new Date().toISOString();
    if (config.fields?.lastDhlCheck) {
      fieldUpdate[config.fields.lastDhlCheck] = nowIso;
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

    const isDelivered = normalise(latestDescription).includes("delivered") || normalise(shipment?.status?.description).includes("delivered");
    if (isDelivered) {
      deliveredDate = String(latest?.timestamp || shipment?.status?.timestamp || "").split("T")[0];
      signedFor = shipment?.proofOfDelivery?.recipientName || latest?.receiverName || latest?.signature || "Unknown";
      if (config.fields?.deliveryDate && deliveredDate) fieldUpdate[config.fields.deliveryDate] = deliveredDate;
      if (config.fields?.signedFor) fieldUpdate[config.fields.signedFor] = signedFor;
    }

    for (const extra of config.additionalFieldMappings || []) {
      if (!extra?.jiraFieldId || !extra?.dhlPath) continue;
      const value = getPath(shipment, extra.dhlPath);
      if (value === undefined || value === null || typeof value === "object") continue;
      fieldUpdate[extra.jiraFieldId] = String(value);
    }

    await updateIssueFields(issueKey, fieldUpdate);

    let transitioned = false;
    if (mapping?.jiraStatus) {
      transitioned = await transitionToStatus(
        issueKey,
        currentStatus,
        mapping.jiraStatus,
        mapping.setResolution || null
      );
    }

    const commentTemplate = mapping?.commentTemplate || "";
    if (config.comments?.enabled && commentTemplate && (transitioned || deliveryStatusChanged)) {
      const comment = renderTemplate(commentTemplate, {
        issueKey,
        trackingNumber,
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
      console.log(`🛑 ${issueKey} marked terminal; future DHL polling will stop.`);
    }

    if (!mapping) {
      console.log(`ℹ️ ${issueKey}: DHL event is currently unmapped. It has been added to the configuration page.`);
    }
  }

  console.log("✅ DHL Tracking v6.1 scheduler complete");
}
