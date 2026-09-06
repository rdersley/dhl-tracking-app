export function sanitizeDhlErrorBody(value, max = 500) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

export function classifyDhlShipmentHttpFailure(status, body = "", retryAfter = "") {
  const code = Number(status) || 0;
  const detail = sanitizeDhlErrorBody(body);
  const retry = String(retryAfter || "").trim();

  if (code === 400) {
    return {
      kind: "validation",
      retryable: false,
      message: detail ? `DHL rejected the shipment data: ${detail}` : "DHL rejected the shipment data. Review the shipment details before retrying.",
    };
  }
  if (code === 401 || code === 403) {
    return {
      kind: "authentication",
      retryable: false,
      message: "DHL rejected the MyDHL API credentials or account permissions. Check the configured test credentials and account access.",
    };
  }
  if (code === 409) {
    return {
      kind: "conflict",
      retryable: false,
      message: detail ? `DHL reported a shipment conflict: ${detail}` : "DHL reported a shipment conflict. Check MyDHL before attempting another shipment.",
    };
  }
  if (code === 429) {
    return {
      kind: "rate_limit",
      retryable: true,
      retryAfter: retry || null,
      message: retry ? `DHL rate-limited the request. Retry after ${retry}.` : "DHL rate-limited the request. Wait before retrying.",
    };
  }
  if (code >= 500) {
    return {
      kind: "service",
      retryable: true,
      message: `DHL service is temporarily unavailable (HTTP ${code}). Do not create a second shipment until MyDHL is checked if the request may have reached DHL.`,
    };
  }
  return {
    kind: "http",
    retryable: false,
    message: detail ? `DHL shipment request failed (HTTP ${code}): ${detail}` : `DHL shipment request failed (HTTP ${code}).`,
  };
}
