import api, { route } from "@forge/api";
import { getDeliveryManagerConfig, getDhlApiKey } from "./config.js";
import {
  normalise,
  parseJiraDate,
  currentDropdownValue,
  collectStatusStrings,
  analyseDHLStatuses,
  compareIssuesForFairRotation,
  latestDhlEvent,
} from "./core.mjs";
import { buildEligibleIssueJql, deliveryDecision, safeDhlRuntimeConfig } from "./dhl-config-core.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validatedDhlUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api-eu.dhl.com") return null;
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function getDHL(trackingNumber, config, apiKey) {
  const baseUrl = validatedDhlUrl(config.dhlApiUrl);
  if (!baseUrl) return { error: true, message: "DHL API URL is invalid" };
  try {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}${separator}trackingNumber=${encodeURIComponent(trackingNumber)}`, {
      method: "GET",
      headers: { "DHL-API-Key": apiKey, Accept: "application/json" },
    });
    if (response.status === 429) return { rateLimited: true, retryAfter: response.headers.get("Retry-After") };
    if (!response.ok) return { error: true, status: response.status, body: await response.text() };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { error: true, message: String(error) };
  }
}

async function updateIssueFields(issueKey, fields) {
  if (!Object.keys(fields || {}).length) return true;
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    console.log(`DHL: failed updating ${issueKey}: ${await response.text()}`);
    return false;
  }
  return true;
}

async function addInternalComment(issueKey, text) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ public: false, body: text }),
  });
  if (!response.ok) console.log(`DHL: comment failed for ${issueKey}: ${await response.text()}`);
  return response.ok;
}

async function transitionToStatus(issueKey, targetStatusName, resolutionName = null) {
  if (!targetStatusName) return true;
  const transitionsResponse = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!transitionsResponse.ok) return false;
  const transitions = (await transitionsResponse.json()).transitions ?? [];
  const match = transitions.find((transition) => normalise(transition.to?.name) === normalise(targetStatusName));
  if (!match) {
    console.log(`DHL: ${issueKey} has no transition to ${targetStatusName}`);
    return false;
  }
  const payload = { transition: { id: match.id } };
  if (resolutionName) payload.fields = { resolution: { name: resolutionName } };
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) console.log(`DHL: transition failed for ${issueKey}: ${await response.text()}`);
  return response.ok;
}

async function searchEligibleIssues(config) {
  const jql = buildEligibleIssueJql(config);
  const fields = [
    config.trackingField,
    config.deliveryStatusField,
    config.deliveryDateField,
    config.signedForField,
    config.dateSentField,
    config.lastDhlCheckField,
    "status",
  ];
  if (config.clientRestrictionEnabled && config.clientField) fields.push(config.clientField);
  const response = await api.asApp().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${config.maxResults}&fields=${fields.join(",")}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).issues ?? [];
}

async function handleDelivered(issueKey, shipment, config) {
  const latest = latestDhlEvent(shipment);
  const deliveredDate = latest?.timestamp?.split("T")[0] ?? null;
  const signedFor = shipment?.proofOfDelivery?.recipientName || latest?.receiverName || latest?.signature || "Unknown";
  const fields = {
    [config.deliveryStatusField]: { value: config.deliveredValue || "Delivered" },
    [config.signedForField]: signedFor,
  };
  if (deliveredDate) fields[config.deliveryDateField] = deliveredDate;
  if (!(await updateIssueFields(issueKey, fields))) return { ok: false, updated: false };
  if (config.commentsEnabled) {
    await addInternalComment(issueKey, [
      "📦 Delivery Manager DHL update",
      "",
      `Delivered: ${deliveredDate ?? "Unknown date"}`,
      `Signed for by: ${signedFor}`,
      "",
      "This update was applied automatically by Delivery Manager.",
    ].join("\n"));
  }
  let transitionOk = true;
  if (config.transitionsEnabled) transitionOk = await transitionToStatus(issueKey, config.resolvedStatus, config.resolutionName || null);
  return { ok: transitionOk, updated: true, transitioned: config.transitionsEnabled ? transitionOk : false };
}

async function handleNonDelivered(issue, analysis, config) {
  const decision = deliveryDecision(analysis, config);
  const currentDeliveryStatus = currentDropdownValue(issue.fields[config.deliveryStatusField]);
  let updated = false;
  if (decision.deliveryStatus && currentDeliveryStatus !== decision.deliveryStatus) {
    updated = await updateIssueFields(issue.key, { [config.deliveryStatusField]: { value: decision.deliveryStatus } });
  }
  let transitioned = false;
  if (decision.workflowStatus && config.transitionsEnabled) {
    transitioned = await transitionToStatus(issue.key, decision.workflowStatus);
  }
  return { ok: true, updated, transitioned, decision };
}

export async function runConfiguredDhl(configOverride = null) {
  const config = safeDhlRuntimeConfig(configOverride || await getDeliveryManagerConfig());
  const apiKey = await getDhlApiKey();
  if (!apiKey) {
    console.log("DHL: API key is not configured in Delivery Manager settings");
    return { ok: false, skipped: true, reason: "api-key-not-configured", eligible: 0, processed: 0 };
  }

  let issues;
  try {
    issues = await searchEligibleIssues(config);
  } catch (error) {
    const result = { ok: false, skipped: false, reason: "jira-search-failed", error: String(error), eligible: 0, processed: 0 };
    console.log(`DHL: Jira search failed: ${result.error}`);
    return result;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - config.minDaysSinceSent);
  issues = issues.filter((issue) => {
    const dateSent = parseJiraDate(issue.fields[config.dateSentField]);
    return !!dateSent && dateSent <= cutoff;
  });
  issues.sort((a, b) => compareIssuesForFairRotation(a, b, config.dateSentField, config.lastDhlCheckField));
  const toProcess = issues.slice(0, config.dhlBatchSize);
  const summary = {
    ok: true,
    skipped: false,
    eligible: issues.length,
    processed: 0,
    delivered: 0,
    updated: 0,
    failedRequests: 0,
    rateLimited: false,
  };
  console.log(`DHL: eligible=${issues.length}, processing=${toProcess.length}`);

  for (const issue of toProcess) {
    const trackingNumber = issue.fields[config.trackingField];
    if (!trackingNumber) continue;
    await sleep(config.dhlDelayMs);
    const dhl = await getDHL(trackingNumber, config, apiKey);
    if (dhl.rateLimited) {
      summary.rateLimited = true;
      summary.ok = false;
      console.log(`DHL: rate limited; Retry-After=${dhl.retryAfter ?? "unknown"}`);
      break;
    }
    summary.processed += 1;
    await updateIssueFields(issue.key, { [config.lastDhlCheckField]: new Date().toISOString() });
    if (!dhl.ok) {
      summary.failedRequests += 1;
      console.log(`DHL: request failed for ${issue.key}: ${dhl.status ?? ""} ${dhl.body ?? dhl.message ?? ""}`);
      continue;
    }
    const shipment = dhl.data?.shipments?.[0];
    if (!shipment) continue;
    const analysis = analyseDHLStatuses(collectStatusStrings(shipment));
    if (analysis.delivered) {
      const result = await handleDelivered(issue.key, shipment, config);
      summary.delivered += 1;
      if (result.updated) summary.updated += 1;
      if (!result.ok) summary.ok = false;
    } else {
      const result = await handleNonDelivered(issue, analysis, config);
      if (result.updated || result.transitioned) summary.updated += 1;
    }
  }

  if (summary.failedRequests > 0) summary.ok = false;
  return summary;
}
