// Helpers for keeping Forge logs short and free of raw API payloads.
//
// Jira and DHL error bodies can echo request data (issue field values,
// addresses, tracking details). Logs only need the HTTP status and a short
// reason, so summariseHttpError() keeps the first error message and caps it.

const MAX_REASON = 120;

function firstMessage(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  // Jira: { errorMessages: [...], errors: { field: "message" } }
  if (Array.isArray(parsed.errorMessages) && parsed.errorMessages.length) return String(parsed.errorMessages[0]);
  if (parsed.errors && typeof parsed.errors === "object") {
    const first = Object.values(parsed.errors)[0];
    if (first) return String(first);
  }
  // DHL (RFC 7807 problem JSON) and generic APIs.
  return String(parsed.title || parsed.detail || parsed.message || "");
}

export function summariseHttpError(status, bodyText = "") {
  let reason = "";
  try {
    reason = firstMessage(JSON.parse(String(bodyText || "")));
  } catch {
    // Non-JSON body (HTML error page etc.): log no body text at all.
    reason = "";
  }
  reason = reason.replace(/\s+/g, " ").trim();
  if (reason.length > MAX_REASON) reason = `${reason.slice(0, MAX_REASON)}…`;
  const code = Number(status) || 0;
  return reason ? `HTTP ${code}: ${reason}` : `HTTP ${code}`;
}

// Reads a failed fetch/requestJira response and returns its short summary.
export async function responseErrorSummary(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  return summariseHttpError(response?.status, text);
}
