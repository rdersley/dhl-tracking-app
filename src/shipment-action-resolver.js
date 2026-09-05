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
  const fields = ["summary", "project", "status", config.trackingField, config.dateSentField].filter(Boolean);
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
  const existingTracking = String(issue?.fields?.[config.trackingField] || recorded?.trackingNumber || "").trim();
  return {
    ok: true,
    issueKey,
    summary: issue?.fields?.summary || "",
    status: issue?.fields?.status?.name || "",
    existingTracking,
    shipmentRecorded: Boolean(recorded?.trackingNumber),
    recorded,
    shippingEnabled: config.dhlShippingEnabled === true,
    shippingEnvironment: config.dhlShippingEnvironment,
    credentialsConfigured: await hasDhlShippingCredentials(),
    accountConfigured: Boolean(config.dhlShippingAccountNumber || config.dhlAccountNumber),
    productConfigured: Boolean(config.dhlProductCode),
    pickupRequestedByDefault: config.dhlPickupRequestedByDefault === true,
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
  if (state.existingTracking || state.shipmentRecorded) {
    return { ok: false, duplicate: true, existingTracking: state.existingTracking || state.recorded?.trackingNumber, error: "A DHL shipment is already recorded for this hardware ticket." };
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
    return { ok: false, dhlRequestFailed: true, error: `DHL shipment request failed: ${String(error)}` };
  }

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, dhlRequestFailed: true, status: response.status, error: `DHL shipment creation failed (${response.status}): ${text.slice(0, 1500)}` };
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
