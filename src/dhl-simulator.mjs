// Simulate mode lets the HW team try the Create DHL Shipment flow end to end
// (duplicate protection, Jira write-back, transitions, attachments) before
// MyDHL credentials exist. Nothing here ever contacts DHL.

// Real DHL tracking numbers are digits/letters without hyphens, so this
// prefix can never collide with a genuine shipment.
export const SIMULATED_TRACKING_PREFIX = "SIM-";

export const SIMULATION_OUTCOMES = {
  success: { label: "Success — shipment created" },
  rejected: { label: "DHL rejects the details (HTTP 400)" },
  authFailed: { label: "DHL rejects the credentials (HTTP 401)" },
  timeout: { label: "Network timeout (outcome unknown)" },
  outage: { label: "DHL outage (HTTP 503, outcome unknown)" },
};

export function cleanSimulationOutcome(value) {
  return Object.prototype.hasOwnProperty.call(SIMULATION_OUTCOMES, value) ? value : "success";
}

export function isSimulatedTrackingNumber(value) {
  return String(value ?? "").trim().toUpperCase().startsWith(SIMULATED_TRACKING_PREFIX);
}

export function simulatedTrackingNumber(random = Math.random) {
  let digits = "";
  for (let i = 0; i < 10; i += 1) digits += Math.floor(random() * 10);
  return `${SIMULATED_TRACKING_PREFIX}${digits}`;
}

// PDF text strings escape backslashes and parentheses; anything outside
// printable ASCII is replaced so the hand-built file stays valid.
function pdfText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

// Builds a one-page A6 PDF with a large SIMULATED banner and a few lines of
// text, returned as base64 like a MyDHL document.
export function buildSimulatedPdf(title, lines = []) {
  const text = [
    "BT /F1 22 Tf 20 380 Td (SIMULATED - NOT A DHL LABEL) Tj ET",
    `BT /F1 14 Tf 20 350 Td (${pdfText(title)}) Tj ET`,
    ...lines.slice(0, 20).map((line, index) => `BT /F1 10 Tf 20 ${325 - index * 14} Td (${pdfText(line)}) Tj ET`),
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1").toString("base64");
}

function partyLine(details = {}) {
  const contact = details.contactInformation || {};
  const address = details.postalAddress || {};
  return [contact.companyName || contact.fullName, address.addressLine1, address.cityName, address.postalCode, address.countryCode]
    .filter(Boolean)
    .join(", ");
}

// Returns what the MyDHL create-shipment call would have returned:
// { networkError: true } or { status, body, retryAfter }. Only the document
// types requested in outputImageProperties are produced.
export function simulateMyDhlCreateShipment(requestBody = {}, outcome = "success", random = Math.random) {
  switch (cleanSimulationOutcome(outcome)) {
    case "timeout":
      return { networkError: true };
    case "outage":
      return { status: 503, body: JSON.stringify({ title: "Service Unavailable", detail: "Simulated DHL outage" }) };
    case "rejected":
      return { status: 400, body: JSON.stringify({ title: "Bad Request", detail: "Simulated validation error: receiver postal code is not valid for the destination" }) };
    case "authFailed":
      return { status: 401, body: JSON.stringify({ title: "Unauthorized", detail: "Simulated credential failure" }) };
    default:
      break;
  }

  const trackingNumber = simulatedTrackingNumber(random);
  const shipper = partyLine(requestBody?.customerDetails?.shipperDetails);
  const receiver = partyLine(requestBody?.customerDetails?.receiverDetails);
  const pkg = requestBody?.content?.packages?.[0] || {};
  const lines = [
    `Tracking: ${trackingNumber}`,
    `Reference: ${pkg?.customerReferences?.[0]?.value || ""}`,
    `From: ${shipper}`,
    `To: ${receiver}`,
    `Package: ${pkg.weight || "?"} kg, ${pkg?.dimensions?.length || "?"}x${pkg?.dimensions?.width || "?"}x${pkg?.dimensions?.height || "?"} cm`,
    `Product: ${requestBody?.productCode || ""}  Planned: ${requestBody?.plannedShippingDateAndTime || ""}`,
  ];

  const titles = { label: "Shipping label", waybillDoc: "Waybill document", receipt: "Shipment receipt" };
  const requested = (requestBody?.outputImageProperties?.imageOptions || [{ typeCode: "label", isRequested: true }])
    .filter((option) => option?.isRequested && titles[option.typeCode]);

  return {
    status: 201,
    body: JSON.stringify({
      shipmentTrackingNumber: trackingNumber,
      dispatchConfirmationNumber: requestBody?.pickup?.isRequested ? `SIMPICKUP${trackingNumber.slice(-6)}` : undefined,
      packages: [{ referenceNumber: 1, trackingNumber }],
      documents: requested.map((option) => ({
        typeCode: option.typeCode,
        imageFormat: "PDF",
        content: buildSimulatedPdf(titles[option.typeCode], lines),
      })),
    }),
  };
}
