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
  if (draft.isCustomsDeclarable === true) {
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

  const planned = draft.plannedShippingDateAndTime || now.toISOString();
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
