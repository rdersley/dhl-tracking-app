export const MAX_DHL_LABEL_BASE64_CHARS = 6_000_000;

export function cleanShipmentText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeCountryCode(value) {
  return cleanShipmentText(value, 2).toUpperCase();
}

export function normalizePositiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

// EU customs union members (ISO codes as used by DHL). Shipments between two of
// these countries need no customs declaration; anything else (e.g. IE -> GB,
// IE -> US) does. Same-country shipments are domestic and need none.
const EU_CUSTOMS_UNION = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

// Decided from the country codes so an agent cannot skip customs by leaving a
// checkbox unticked. The checkbox can still force a declaration on.
export function requiresCustomsDeclaration(draft = {}) {
  if (draft.isCustomsDeclarable === true) return true;
  const from = normalizeCountryCode(draft.shipper?.countryCode);
  const to = normalizeCountryCode(draft.receiver?.countryCode);
  if (from.length !== 2 || to.length !== 2) return false; // reported by validation instead
  if (from === to) return false;
  return !(EU_CUSTOMS_UNION.has(from) && EU_CUSTOMS_UNION.has(to));
}

// MyDHL API expects "YYYY-MM-DDTHH:MM:SSGMT+HH:MM", not ISO-8601 with "Z" or
// milliseconds. Times are sent in UTC; a short lead time stops DHL rejecting a
// shipping time that is already in the past when the request arrives.
const PLANNED_LEAD_MINUTES = 10;
const MYDHL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}GMT[+-]\d{2}:\d{2}$/;

export function formatMyDhlDateTime(value, now = new Date()) {
  if (typeof value === "string" && MYDHL_DATETIME.test(value.trim())) return value.trim();
  const parsed = value ? new Date(value) : new Date(now.getTime() + PLANNED_LEAD_MINUTES * 60 * 1000);
  const date = Number.isNaN(parsed.getTime()) ? new Date(now.getTime() + PLANNED_LEAD_MINUTES * 60 * 1000) : parsed;
  return `${date.toISOString().slice(0, 19)}GMT+00:00`;
}

// The shipment record (a Jira issue property) moves through:
//   none -> pending (written BEFORE calling DHL) -> created
// A pending record that never completed means the DHL outcome is unknown, so it
// blocks another attempt until someone has checked MyDHL and cleared it.
export function shipmentRecordState(recorded) {
  if (!recorded || typeof recorded !== "object") return "none";
  if (recorded.state === "pending") return "pending";
  if (cleanShipmentText(recorded.trackingNumber)) return "created";
  return "invalid";
}

export function buildPendingShipmentRecord(requestId, now = new Date()) {
  return { state: "pending", requestId: String(requestId), startedAt: now.toISOString() };
}

export function buildCreatedShipmentRecord(result = {}, now = new Date()) {
  return {
    state: "created",
    trackingNumber: result.trackingNumber,
    dispatchConfirmationNumber: result.dispatchConfirmationNumber || "",
    createdAt: now.toISOString(),
  };
}

// Only failures where DHL definitely did NOT create a shipment may release the
// pending record. Network errors, 5xx and unreadable success responses keep it.
export function isDefinitiveShipmentFailure(status) {
  const code = Number(status) || 0;
  return code >= 400 && code < 500 && code !== 408;
}

// Repair only what is missing. A ticket that already shows the recorded
// tracking number is left alone, so reopening the action on a shipped ticket
// never resets Date Sent, Delivery Status or the workflow.
export function buildShipmentRepairPlan(fields = {}, recorded = {}, config = {}) {
  const trackingNumber = cleanShipmentText(recorded.trackingNumber, 100);
  if (!trackingNumber) return { action: "invalid" };

  const fieldTracking = cleanShipmentText(config.trackingField ? fields[config.trackingField] : "", 100);
  if (fieldTracking && fieldTracking !== trackingNumber) return { action: "conflict", trackingNumber, fieldTracking };
  if (fieldTracking === trackingNumber) return { action: "none", trackingNumber };

  const update = {};
  if (config.trackingField) update[config.trackingField] = trackingNumber;
  if (config.dateSentField && !fields[config.dateSentField]) {
    update[config.dateSentField] = String(recorded.createdAt || new Date().toISOString()).slice(0, 10);
  }
  if (config.deliveryStatusField && config.inTransitValue && !fields[config.deliveryStatusField]) {
    update[config.deliveryStatusField] = { value: config.inTransitValue };
  }
  return { action: "repair", trackingNumber, fields: update, transition: true };
}

export function validateShipmentDraft(draft = {}, config = {}) {
  const errors = [];
  const requireText = (value, label) => {
    if (!cleanShipmentText(value)) errors.push(`${label} is required`);
  };

  requireText(config.dhlShippingAccountNumber || config.dhlAccountNumber, "DHL shipping account number");
  requireText(draft.reference, "Shipment reference");
  requireText(draft.shipper?.name, "Shipper name");
  requireText(draft.shipper?.address1, "Shipper address");
  requireText(draft.shipper?.city, "Shipper city");
  requireText(draft.shipper?.postalCode, "Shipper postal code");
  if (normalizeCountryCode(draft.shipper?.countryCode).length !== 2) errors.push("Shipper country code must be two letters");
  requireText(draft.receiver?.name, "Receiver name");
  requireText(draft.receiver?.address1, "Receiver address");
  requireText(draft.receiver?.city, "Receiver city");
  requireText(draft.receiver?.postalCode, "Receiver postal code");
  if (normalizeCountryCode(draft.receiver?.countryCode).length !== 2) errors.push("Receiver country code must be two letters");
  if (!normalizePositiveNumber(draft.package?.weightKg)) errors.push("Package weight must be greater than zero");
  if (!normalizePositiveNumber(draft.package?.lengthCm)) errors.push("Package length must be greater than zero");
  if (!normalizePositiveNumber(draft.package?.widthCm)) errors.push("Package width must be greater than zero");
  if (!normalizePositiveNumber(draft.package?.heightCm)) errors.push("Package height must be greater than zero");
  requireText(config.dhlProductCode, "DHL product code");
  if (requiresCustomsDeclaration(draft)) {
    errors.push("Customs-declarable shipments are not enabled yet; full customs line-item data is required before shipment creation");
  }

  return { ok: errors.length === 0, errors };
}

function partyDetails(party = {}) {
  const address = {
    postalCode: cleanShipmentText(party.postalCode, 20),
    cityName: cleanShipmentText(party.city, 100),
    countryCode: normalizeCountryCode(party.countryCode),
    addressLine1: cleanShipmentText(party.address1, 200),
  };
  if (cleanShipmentText(party.address2)) address.addressLine2 = cleanShipmentText(party.address2, 200);
  if (cleanShipmentText(party.county)) address.countyName = cleanShipmentText(party.county, 100);

  const contact = {
    companyName: cleanShipmentText(party.company || party.name, 100),
    fullName: cleanShipmentText(party.name, 100),
  };
  if (cleanShipmentText(party.phone)) contact.phone = cleanShipmentText(party.phone, 40);
  if (cleanShipmentText(party.email)) contact.email = cleanShipmentText(party.email, 200);

  return { postalAddress: address, contactInformation: contact };
}

export function buildMyDhlShipmentPayload(draft = {}, config = {}, now = new Date()) {
  const validation = validateShipmentDraft(draft, config);
  if (!validation.ok) {
    const error = new Error(`Shipment is not ready: ${validation.errors.join("; ")}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  const planned = formatMyDhlDateTime(draft.plannedShippingDateAndTime, now);
  const accountNumber = cleanShipmentText(config.dhlShippingAccountNumber || config.dhlAccountNumber, 100);
  const productCode = cleanShipmentText(config.dhlProductCode, 20);

  return {
    plannedShippingDateAndTime: planned,
    pickup: { isRequested: draft.pickupRequested === true },
    productCode,
    accounts: [{ typeCode: "shipper", number: accountNumber }],
    customerDetails: {
      shipperDetails: partyDetails(draft.shipper),
      receiverDetails: partyDetails(draft.receiver),
    },
    content: {
      packages: [{
        weight: normalizePositiveNumber(draft.package.weightKg),
        dimensions: {
          length: normalizePositiveNumber(draft.package.lengthCm),
          width: normalizePositiveNumber(draft.package.widthCm),
          height: normalizePositiveNumber(draft.package.heightCm),
        },
        customerReferences: [{ value: cleanShipmentText(draft.reference, 100), typeCode: "CU" }],
        description: cleanShipmentText(draft.package.description || "Hardware", 200),
      }],
      isCustomsDeclarable: false,
      description: cleanShipmentText(draft.contentsDescription || draft.package.description || "Hardware", 200),
      unitOfMeasurement: "metric",
    },
  };
}

export function extractMyDhlShipmentResult(response = {}) {
  const trackingNumber = cleanShipmentText(
    response.shipmentTrackingNumber ||
    response.trackingNumber ||
    response?.packages?.[0]?.trackingNumber ||
    response?.packages?.[0]?.trackingId,
    100
  );
  const dispatchConfirmationNumber = cleanShipmentText(response.dispatchConfirmationNumber, 100);
  const documents = Array.isArray(response.documents) ? response.documents : [];
  const label = documents.find((document) => /label/i.test(String(document?.typeCode || document?.type || ""))) || documents[0] || null;
  const rawLabel = String(label?.content || "").trim();
  const labelTooLarge = rawLabel.length > MAX_DHL_LABEL_BASE64_CHARS;
  return {
    ok: Boolean(trackingNumber),
    trackingNumber,
    dispatchConfirmationNumber,
    labelBase64: labelTooLarge ? "" : rawLabel,
    labelFormat: cleanShipmentText(label?.imageFormat || label?.format || label?.typeCode, 50),
    labelTooLarge,
    rawDocumentCount: documents.length,
  };
}

export function buildShipmentWriteback(result = {}, config = {}) {
  const fields = {};
  if (result.trackingNumber && config.trackingField) fields[config.trackingField] = result.trackingNumber;
  if (config.dateSentField) fields[config.dateSentField] = new Date().toISOString().slice(0, 10);
  if (config.deliveryStatusField && config.inTransitValue) fields[config.deliveryStatusField] = { value: config.inTransitValue };
  return fields;
}
