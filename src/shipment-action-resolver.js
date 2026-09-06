import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import {
  getDeliveryManagerConfig,
  getDhlShippingCredentials,
  hasDhlShippingCredentials,
} from "./config.js";
import {
  buildMyDhlShipmentPayload,
  buildShipmentWriteback,
  extractMyDhlShipmentResult,
  validateShipmentDraft,
} from "./shipment-core.mjs";
import { classifyDhlShipmentHttpFailure } from "./dhl-shipping-http-core.mjs";

const resolver = new Resolver();
const SHIPMENT_PROPERTY = "nuvriqo.delivery-manager.dhl-shipment";

async function jiraJson(path, options = {}) {
  const response = await api.asApp().requestJira(path, {
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

async function readShipmentProperty(issueKey) {
  const result = await jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${SHIPMENT_PROPERTY}`);
  return result.ok ? result.data?.value || null : null;
}

async function recordShipmentProperty(issueKey, result) {
  return jiraJson(route`/rest/api/3/issue/${issueKey}/properties/${SHIPMENT_PROPERTY}`, {
    method: "PUT",
    body: JSON.stringify({
      trackingNumber: result.trackingNumber,
      dispatchConfirmationNumber: result.dispatchConfirmationNumber || "",
      createdAt: new Date().toISOString(),
    }),
  });
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

async function attachLabel(issueKey, result) {
  if (result.labelTooLarge) return { ok: false, skipped: true, error: "DHL label exceeded the Delivery Manager attachment safety limit." };
  if (!result.labelBase64) return { ok: true, skipped: true };
  try {
    const bytes = Buffer.from(result.labelBase64, "base64");
    if (!bytes.length) return { ok: false, error: "DHL returned an empty label." };
    const format = String(result.labelFormat || "PDF").toUpperCase();
    const extension = format.includes("PNG") ? "png" : format.includes("ZPL") ? "zpl" : "pdf";
    const mime = extension === "png" ? "image/png" : extension === "zpl" ? "text/plain" : "application/pdf";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `DHL-${result.trackingNumber}-label.${extension}`);
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
      method: "POST",
      headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" },
      body: form,
    });
    if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
    const data = await response.json();
    return { ok: true, attachmentId: data?.[0]?.id || null, filename: data?.[0]?.filename || null };
  } catch (error) {
    return { ok: false, error: String(error) };
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

  const recorded = await readShipmentProperty(issueKey);
  const fieldTracking = String(issue?.fields?.[config.trackingField] || "").trim();
  const recordedTracking = String(recorded?.trackingNumber || "").trim();
  return {
    ok: true,
    issueKey,
    summary: issue?.fields?.summary || "",
    status: issue?.fields?.status?.name || "",
    fieldTracking,
    existingTracking: fieldTracking || recordedTracking,
    shipmentRecorded: Boolean(recordedTracking),
    recorded,
    shippingEnabled: config.dhlShippingEnabled === true,
    shippingEnvironment: config.dhlShippingEnvironment,
    credentialsConfigured: await hasDhlShippingCredentials(),
    accountConfigured: Boolean(config.dhlShippingAccountNumber || config.dhlAccountNumber),
    productConfigured: Boolean(config.dhlProductCode),
    pickupRequestedByDefault: config.dhlPickupRequestedByDefault === true,
  };
}

async function repairRecordedShipment(issueKey, state, config) {
  const trackingNumber = String(state.recorded?.trackingNumber || "").trim();
  if (!trackingNumber) return { ok: false, duplicate: true, error: "A shipment record exists but has no tracking number. Manual review is required." };

  const repairResult = { trackingNumber };
  const updateResult = await jiraJson(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: buildShipmentWriteback(repairResult, config) }),
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

resolver.define("createDhlShipment", async ({ payload }) => {
  const issueKey = String(payload?.issueKey || "").trim();
  const draft = payload?.draft || {};
  if (!issueKey) return { ok: false, error: "No Jira issue was supplied." };

  const config = await getDeliveryManagerConfig();
  if (!config.dhlShippingEnabled) return { ok: false, disabled: true, error: "DHL shipment creation is disabled in Delivery Manager settings." };
  if (config.dhlShippingEnvironment === "production" && payload?.confirmProduction !== true) {
    return { ok: false, productionConfirmationRequired: true, error: "Production shipment creation requires explicit confirmation." };
  }

  const state = await inspect(issueKey, config);
  if (!state.ok) return state;
  if (state.shipmentRecorded) return repairRecordedShipment(issueKey, state, config);
  if (state.fieldTracking) {
    return { ok: false, duplicate: true, existingTracking: state.fieldTracking, error: "A tracking number already exists on this hardware ticket. Delivery Manager will not create another DHL shipment without manual review." };
  }

  const validation = validateShipmentDraft(draft, config);
  if (!validation.ok) return { ok: false, validation: true, errors: validation.errors, error: validation.errors.join("; ") };

  const credentials = await getDhlShippingCredentials();
  if (!credentials.username || !credentials.password) return { ok: false, error: "DHL shipping credentials are not configured." };

  let requestBody;
  try {
    requestBody = buildMyDhlShipmentPayload(draft, config);
  } catch (error) {
    return { ok: false, validation: true, errors: error.validationErrors || [], error: String(error.message || error) };
  }

  const base = String(config.dhlShippingApiUrl || "").replace(/\/$/, "");
  const url = `${base}/shipments`;
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
  let response;
  try {
    response = await api.fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return {
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
    return {
      ok: false,
      dhlRequestFailed: true,
      status: response.status,
      failureKind: failure.kind,
      retryable: failure.retryable,
      retryAfter: failure.retryAfter || null,
      ambiguousDeliveryState: response.status >= 500,
      error: failure.message,
    };
  }

  const dhlResponse = await response.json();
  const result = extractMyDhlShipmentResult(dhlResponse);
  if (!result.ok) return { ok: false, dhlResponseInvalid: true, error: "DHL accepted the shipment but did not return a tracking number. Do not retry until this shipment is checked in MyDHL." };

  const recordResult = await recordShipmentProperty(issueKey, result);
  if (!recordResult.ok) {
    return { ok: false, created: true, recordFailed: true, trackingNumber: result.trackingNumber, dispatchConfirmationNumber: result.dispatchConfirmationNumber, error: "DHL created the shipment, but Delivery Manager could not record its duplicate-prevention safeguard. Do not retry shipment creation." };
  }

  const updateResult = await jiraJson(route`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: buildShipmentWriteback(result, config) }),
  });
  const labelResult = await attachLabel(issueKey, result);
  const transitionResult = config.transitionsEnabled ? await transitionIssue(issueKey, config.hwDispatchedStatus) : { ok: true, skipped: true };

  if (config.commentsEnabled) {
    const parts = [`DHL shipment created. Tracking number: ${result.trackingNumber}.`];
    if (result.dispatchConfirmationNumber) parts.push(`Dispatch confirmation: ${result.dispatchConfirmationNumber}.`);
    if (labelResult.ok && !labelResult.skipped) parts.push("Shipping label attached to this issue.");
    if (result.labelTooLarge) parts.push("DHL returned a label that exceeded the Delivery Manager attachment safety limit, so it was not attached.");
    await addPrivateComment(issueKey, parts.join(" "));
  }

  return {
    ok: updateResult.ok && transitionResult.ok,
    created: true,
    trackingNumber: result.trackingNumber,
    dispatchConfirmationNumber: result.dispatchConfirmationNumber,
    jiraUpdated: updateResult.ok,
    labelAttached: labelResult.ok && !labelResult.skipped,
    labelAttachmentId: labelResult.attachmentId || null,
    labelError: labelResult.ok ? null : labelResult.error,
    transitioned: transitionResult.ok && !transitionResult.skipped,
    transitionError: transitionResult.ok ? null : transitionResult.error,
    warning: !updateResult.ok || !labelResult.ok || !transitionResult.ok,
    error: !updateResult.ok ? `Shipment created but Jira field update failed: ${updateResult.error}` : !transitionResult.ok ? `Shipment created but Jira transition failed: ${transitionResult.error}` : null,
  };
});

export const handler = resolver.getDefinitions();
