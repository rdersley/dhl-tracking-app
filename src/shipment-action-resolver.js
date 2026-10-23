import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import {
  getDeliveryManagerConfig,
  getDhlShippingCredentials,
  hasDhlShippingCredentials,
} from "./config.js";
import { randomUUID } from "node:crypto";
import {
  buildCreatedShipmentRecord,
  buildMyDhlShipmentPayload,
  buildPendingShipmentRecord,
  buildShipmentRepairPlan,
  buildShipmentWriteback,
  documentFilename,
  extractMyDhlShipmentResult,
  isDefinitiveShipmentFailure,
  shipmentRecordState,
  validateShipmentDraft,
} from "./shipment-core.mjs";
import { classifyDhlShipmentHttpFailure } from "./dhl-shipping-http-core.mjs";
import { simulateMyDhlCreateShipment } from "./dhl-simulator.mjs";

function isSimulated(config) {
  return config?.dhlShippingEnvironment === "simulate";
}

// Simulate mode must pass the same draft validation as a real request, so
// placeholder account/product values stand in for settings not yet entered.
function withSimulationDefaults(config) {
  return {
    ...config,
    dhlShippingAccountNumber: config.dhlShippingAccountNumber || config.dhlAccountNumber || "SIMULATED",
    dhlProductCode: config.dhlProductCode || "P",
  };
}

// Mimics the subset of the fetch Response API used below, so a simulated
// request goes through exactly the same success/failure handling as a real one.
function simulatedFetch(requestBody, outcome) {
  const simulated = simulateMyDhlCreateShipment(requestBody, outcome);
  if (simulated.networkError) throw new Error("Simulated network timeout");
  return {
    ok: simulated.status >= 200 && simulated.status < 300,
    status: simulated.status,
    headers: { get: () => null },
    text: async () => simulated.body,
    json: async () => JSON.parse(simulated.body),
  };
}

const resolver = new Resolver();
const SHIPMENT_PROPERTY = "nuvriqo.delivery-manager.dhl-shipment";
// Jira issue properties have no compare-and-set, so after writing the pending
// record we wait briefly and re-read it. If two requests raced, only the one
// whose requestId survived goes on to call DHL.
const PENDING_SETTLE_MS = 1500;
const PENDING_CLEAR_MIN_AGE_MS = 2 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jiraJson(path, options = {}) {
  const response = await api.asApp().requestJira(path, {
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

// Returns { ok, value }. Only a 404 means "no record"; any other failure is
// reported so callers fail closed instead of assuming no shipment exists.
async function readShipmentProperty(issueKey) {
  const result = await jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${SHIPMENT_PROPERTY}`);
  if (result.ok) return { ok: true, value: result.data?.value || null };
  if (result.status === 404) return { ok: true, value: null };
  return { ok: false, error: result.error };
}

async function writeShipmentProperty(issueKey, value) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${SHIPMENT_PROPERTY}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

async function deleteShipmentProperty(issueKey) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${SHIPMENT_PROPERTY}`, { method: "DELETE" });
}

async function getHardwareIssue(issueKey, config) {
  const fields = ["summary", "project", "status", config.trackingField, config.dateSentField, config.deliveryStatusField].filter(Boolean);
  return jiraJson(route`/rest/api/3/issue/${issueKey}?fields=${fields.join(",")}`);
}

async function transitionIssue(issueKey, targetStatus) {
  if (!targetStatus) return { ok: true, skipped: true };
  const transitions = await jiraJson(route`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`);
  if (!transitions.ok) return transitions;
  const target = (transitions.data?.transitions || []).find(
    (item) => String(item?.to?.name || "").trim().toLowerCase() === String(targetStatus).trim().toLowerCase()
  );
  if (!target) return { ok: false, error: `No Jira transition to ${targetStatus} is available.` };
  return jiraJson(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: target.id } }),
  });
}

async function addPrivateComment(issueKey, body) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
      },
      properties: [{ key: "sd.public.comment", value: { internal: true } }],
    }),
  });
}

// Uploads every DHL document (label, waybill, receipt) to the hardware ticket
// in a single multipart request. Documents over the size budget are skipped and
// reported so the agent knows to download them from MyDHL instead.
async function attachDocuments(issueKey, result) {
  const documents = result.documents || [];
  const tooLarge = documents.filter((document) => document.tooLarge).map((document) => document.kind);
  const usable = documents.filter((document) => !document.tooLarge && document.base64);
  if (!usable.length) {
    return { ok: !tooLarge.length, skipped: true, attached: [], tooLarge, error: tooLarge.length ? "DHL documents exceeded the Delivery Manager attachment safety limit." : null };
  }

  try {
    const form = new FormData();
    const seen = {};
    const names = [];
    for (const document of usable) {
      const bytes = Buffer.from(document.base64, "base64");
      if (!bytes.length) continue;
      const filename = documentFilename(result.trackingNumber, document, seen[document.kind] || 0);
      seen[document.kind] = (seen[document.kind] || 0) + 1;
      const mime = filename.endsWith(".png") ? "image/png" : filename.endsWith(".zpl") ? "text/plain" : "application/pdf";
      form.append("file", new Blob([bytes], { type: mime }), filename);
      names.push({ kind: document.kind, filename });
    }
    if (!names.length) return { ok: false, attached: [], tooLarge, error: "DHL returned empty documents." };

    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
      method: "POST",
      headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" },
      body: form,
    });
    if (!response.ok) return { ok: false, status: response.status, attached: [], tooLarge, error: await response.text() };
    const data = await response.json();
    const attached = names.map((item) => ({
      ...item,
      id: (data || []).find((attachment) => attachment?.filename === item.filename)?.id || null,
    }));
    return {
      ok: !tooLarge.length,
      attached,
      tooLarge,
      error: tooLarge.length ? `Not attached because of the size limit: ${tooLarge.join(", ")}. Download them from MyDHL.` : null,
    };
  } catch (error) {
    return { ok: false, attached: [], tooLarge, error: String(error) };
  }
}

async function inspect(issueKey, config) {
  const issueResult = await getHardwareIssue(issueKey, config);
  if (!issueResult.ok) return { ok: false, error: `Could not read ${issueKey}: ${issueResult.error}` };
  const issue = issueResult.data;
  const projectKey = String(issue?.fields?.project?.key || "");
  if (projectKey.toUpperCase() !== String(config.hwProject || "").toUpperCase()) {
    return { ok: false, wrongProject: true, error: `DHL shipment creation is configured for ${config.hwProject} issues, not ${projectKey || "this project"}.` };
  }

  const record = await readShipmentProperty(issueKey);
  if (!record.ok) return { ok: false, error: `Could not read the DHL shipment record for ${issueKey}, so shipment creation is blocked to avoid a duplicate: ${record.error}` };
  const recorded = record.value;
  const recordState = shipmentRecordState(recorded);
  const fieldTracking = String(issue?.fields?.[config.trackingField] || "").trim();
  const recordedTracking = String(recorded?.trackingNumber || "").trim();
  return {
    ok: true,
    issueKey,
    summary: issue?.fields?.summary || "",
    status: issue?.fields?.status?.name || "",
    fields: issue?.fields || {},
    fieldTracking,
    existingTracking: fieldTracking || recordedTracking,
    shipmentRecorded: recordState === "created",
    shipmentPending: recordState === "pending",
    pendingSince: recordState === "pending" ? recorded.startedAt || null : null,
    recordState,
    recorded,
    shippingEnabled: config.dhlShippingEnabled === true,
    shippingEnvironment: config.dhlShippingEnvironment,
    // Simulate mode needs no DHL credentials, account or product code.
    credentialsConfigured: isSimulated(config) || await hasDhlShippingCredentials(),
    accountConfigured: isSimulated(config) || Boolean(config.dhlShippingAccountNumber || config.dhlAccountNumber),
    productConfigured: isSimulated(config) || Boolean(config.dhlProductCode),
    pickupRequestedByDefault: config.dhlPickupRequestedByDefault === true,
  };
}

async function repairRecordedShipment(issueKey, state, config) {
  const plan = buildShipmentRepairPlan(state.fields, state.recorded, config);
  if (plan.action === "invalid") return { ok: false, duplicate: true, error: "A shipment record exists but has no tracking number. Manual review is required." };
  if (plan.action === "conflict") {
    return { ok: false, duplicate: true, trackingNumber: plan.trackingNumber, error: `The ticket shows tracking number ${plan.fieldTracking} but the recorded DHL shipment is ${plan.trackingNumber}. Manual review is required.` };
  }
  if (plan.action === "none") {
    return { ok: true, created: false, duplicatePrevented: true, trackingNumber: plan.trackingNumber, error: null };
  }

  const trackingNumber = plan.trackingNumber;
  const updateResult = await jiraJson(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: plan.fields }),
  });
  const transitionResult = config.transitionsEnabled ? await transitionIssue(issueKey, config.hwDispatchedStatus) : { ok: true, skipped: true };

  if (config.commentsEnabled && (updateResult.ok || transitionResult.ok)) {
    await addPrivateComment(issueKey, `Delivery Manager repaired Jira from the existing DHL shipment record. Tracking number: ${trackingNumber}. No new DHL shipment was created.`);
  }

  return {
    ok: updateResult.ok && transitionResult.ok,
    created: false,
    repaired: true,
    duplicatePrevented: true,
    trackingNumber,
    jiraUpdated: updateResult.ok,
    transitioned: transitionResult.ok && !transitionResult.skipped,
    transitionError: transitionResult.ok ? null : transitionResult.error,
    error: !updateResult.ok ? `Existing DHL shipment was preserved, but Jira field repair failed: ${updateResult.error}` : !transitionResult.ok ? `Existing DHL shipment was preserved, but Jira transition repair failed: ${transitionResult.error}` : null,
  };
}

resolver.define("checkDhlShipment", async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };
  const config = await getDeliveryManagerConfig();
  return inspect(issueKey, config);
});

resolver.define("validateDhlShipment", async ({ payload }) => {
  const config = await getDeliveryManagerConfig();
  return validateShipmentDraft(payload?.draft || {}, config);
});

// Releases a pending record left by an interrupted or ambiguous DHL request.
// Only pending records can be cleared, and the agent must confirm they checked
// MyDHL and found no shipment; an internal comment records who cleared it.
resolver.define("clearPendingDhlShipment", async ({ payload, context }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };
  if (payload?.confirmCheckedMyDhl !== true) {
    return { ok: false, error: "Confirm that MyDHL shows no shipment for this ticket before clearing the pending request." };
  }

  const config = await getDeliveryManagerConfig();
  const state = await inspect(issueKey, config);
  if (!state.ok) return state;
  if (!state.shipmentPending) return { ok: false, error: "There is no pending DHL shipment request to clear on this ticket." };
  // A request younger than this may still be talking to DHL right now.
  const startedAt = new Date(state.pendingSince || 0).getTime();
  if (Date.now() - startedAt < PENDING_CLEAR_MIN_AGE_MS) {
    return { ok: false, error: "This shipment request started less than two minutes ago and may still be in progress. Wait, then check MyDHL before clearing it." };
  }

  const cleared = await deleteShipmentProperty(issueKey);
  if (!cleared.ok) return { ok: false, error: `Could not clear the pending shipment request: ${cleared.error}` };

  await addPrivateComment(
    issueKey,
    `Pending DHL shipment request (started ${state.pendingSince || "unknown"}) was cleared by account ${context?.accountId || "unknown"} after confirming MyDHL shows no shipment. A new shipment can now be created.`
  );
  return { ok: true, cleared: true };
});

resolver.define("createDhlShipment", async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  const draft = payload?.draft || {};
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };

  const savedConfig = await getDeliveryManagerConfig();
  const simulate = isSimulated(savedConfig);
  const config = simulate ? withSimulationDefaults(savedConfig) : savedConfig;
  const label = simulate ? "[SIMULATED] " : "";
  if (!config.dhlShippingEnabled) return { ok: false, disabled: true, error: "DHL shipment creation is disabled in Delivery Manager settings." };
  if (config.dhlShippingEnvironment === "production" && payload?.confirmProduction !== true) {
    return { ok: false, productionConfirmationRequired: true, error: "Production shipment creation requires explicit confirmation." };
  }

  const state = await inspect(issueKey, config);
  if (!state.ok) return state;
  if (state.shipmentPending) {
    return { ok: false, duplicate: true, pending: true, pendingSince: state.pendingSince, error: "A DHL shipment request for this ticket is in progress or its outcome is unknown. Check MyDHL before clearing it and trying again." };
  }
  if (state.shipmentRecorded || state.recordState === "invalid") return repairRecordedShipment(issueKey, state, config);
  if (state.fieldTracking) {
    return { ok: false, duplicate: true, existingTracking: state.fieldTracking, error: "A tracking number already exists on this hardware ticket. Delivery Manager will not create another DHL shipment without manual review." };
  }

  const validation = validateShipmentDraft(draft, config);
  if (!validation.ok) return { ok: false, validation: true, errors: validation.errors, error: validation.errors.join("; ") };

  const credentials = simulate ? null : await getDhlShippingCredentials();
  if (!simulate && (!credentials.username || !credentials.password)) return { ok: false, error: "DHL shipping credentials are not configured." };

  let requestBody;
  try {
    requestBody = buildMyDhlShipmentPayload(draft, config);
  } catch (error) {
    return { ok: false, validation: true, errors: error.validationErrors || [], error: String(error.message || error) };
  }

  // Claim the ticket before calling DHL. From here on, anything other than a
  // definite DHL rejection leaves the pending record in place so a retry or a
  // second agent cannot create a duplicate (paid) shipment.
  const requestId = randomUUID();
  const claim = await writeShipmentProperty(issueKey, buildPendingShipmentRecord(requestId));
  if (!claim.ok) return { ok: false, error: `Could not record the shipment request on ${issueKey}, so DHL was not contacted: ${claim.error}` };
  await sleep(PENDING_SETTLE_MS);
  const settled = await readShipmentProperty(issueKey);
  if (!settled.ok || settled.value?.requestId !== requestId) {
    return { ok: false, duplicate: true, pending: true, error: "Another shipment request for this ticket started at the same time. DHL was not contacted by this request; check the ticket again in a moment." };
  }

  let response;
  try {
    response = simulate
      ? simulatedFetch(requestBody, payload?.simulateOutcome)
      : await api.fetch(`${String(config.dhlShippingApiUrl || "").replace(/\/$/, "")}/shipments`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
        },
        body: JSON.stringify(requestBody),
      });
  } catch (error) {
    return {
      pending: true,
      ok: false,
      dhlRequestFailed: true,
      ambiguousDeliveryState: true,
      retryable: true,
      error: "The DHL request failed before Delivery Manager received a response. Check MyDHL before retrying because the shipment request may have reached DHL.",
    };
  }

  if (!response.ok) {
    const text = await response.text();
    const failure = classifyDhlShipmentHttpFailure(response.status, text, response.headers?.get?.("retry-after") || "");
    const definitive = isDefinitiveShipmentFailure(response.status);
    // A definite rejection means DHL created nothing, so release the claim and
    // let the agent correct the details and retry.
    if (definitive) await deleteShipmentProperty(issueKey);
    return {
      ok: false,
      pending: !definitive,
      dhlRequestFailed: true,
      status: response.status,
      failureKind: failure.kind,
      retryable: failure.retryable,
      retryAfter: failure.retryAfter || null,
      ambiguousDeliveryState: !definitive,
      error: failure.message,
    };
  }

  let dhlResponse = null;
  try {
    dhlResponse = await response.json();
  } catch {
    dhlResponse = null;
  }
  const result = extractMyDhlShipmentResult(dhlResponse || {});
  if (!result.ok) return { ok: false, pending: true, dhlResponseInvalid: true, error: "DHL accepted the shipment but did not return a tracking number. Do not retry until this shipment is checked in MyDHL." };

  // If this write fails the pending record stays, which still blocks a
  // duplicate; the agent is told the tracking number to enter manually.
  const recordResult = await writeShipmentProperty(issueKey, buildCreatedShipmentRecord(result));
  if (!recordResult.ok) {
    return { ok: false, created: true, recordFailed: true, trackingNumber: result.trackingNumber, dispatchConfirmationNumber: result.dispatchConfirmationNumber, error: "DHL created the shipment, but Delivery Manager could not record it. Do not retry shipment creation; enter the tracking number on the ticket manually." };
  }

  const updateResult = await jiraJson(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: buildShipmentWriteback(result, config) }),
  });
  const documentsResult = await attachDocuments(issueKey, result);
  const attachedLabel = documentsResult.attached.find((item) => item.kind === "label") || null;
  const transitionResult = config.transitionsEnabled ? await transitionIssue(issueKey, config.hwDispatchedStatus) : { ok: true, skipped: true };

  if (config.commentsEnabled) {
    const parts = [`${label}DHL shipment created. Tracking number: ${result.trackingNumber}.`];
    if (simulate) parts.push("This is a simulated shipment: DHL was not contacted and nothing will be collected or charged.");
    if (result.dispatchConfirmationNumber) parts.push(`Dispatch confirmation: ${result.dispatchConfirmationNumber}.`);
    if (documentsResult.attached.length) parts.push(`Attached to this issue for printing: ${documentsResult.attached.map((item) => item.filename).join(", ")}.`);
    if (documentsResult.tooLarge.length) parts.push(`Not attached because they exceeded the size limit (download from MyDHL): ${documentsResult.tooLarge.join(", ")}.`);
    if (!documentsResult.ok && !documentsResult.tooLarge.length && documentsResult.error) parts.push("The DHL documents could not be attached; download them from MyDHL.");
    await addPrivateComment(issueKey, parts.join(" "));
  }

  return {
    ok: updateResult.ok && transitionResult.ok,
    created: true,
    trackingNumber: result.trackingNumber,
    dispatchConfirmationNumber: result.dispatchConfirmationNumber,
    jiraUpdated: updateResult.ok,
    labelAttached: Boolean(attachedLabel),
    labelAttachmentId: attachedLabel?.id || null,
    documentsAttached: documentsResult.attached.map((item) => item.filename),
    labelError: documentsResult.ok ? null : documentsResult.error,
    transitioned: transitionResult.ok && !transitionResult.skipped,
    transitionError: transitionResult.ok ? null : transitionResult.error,
    warning: !updateResult.ok || !documentsResult.ok || !transitionResult.ok,
    error: !updateResult.ok ? `Shipment created but Jira field update failed: ${updateResult.error}` : !transitionResult.ok ? `Shipment created but Jira transition failed: ${transitionResult.error}` : null,
  };
});

export const handler = resolver.getDefinitions();
