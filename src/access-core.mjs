// Authorisation and "is this configured?" logic for Delivery Manager.
//
// This module has no Forge imports so it can be unit tested with `node --test`.
// The Forge-specific call to Jira (api.asUser() + /rest/api/3/mypermissions)
// is injected by access.js through createAccessGuards().

// Jira issue keys look like ABC-123. Rejecting anything else before we build
// REST paths keeps odd payloads (paths, JQL, very long strings) out of Jira calls.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,254}-[1-9][0-9]{0,17}$/;

export function isValidIssueKey(value) {
  return ISSUE_KEY_RE.test(String(value || "").trim().toUpperCase());
}

// The /rest/api/3/mypermissions response looks like
// { permissions: { EDIT_ISSUES: { havePermission: true, ... }, ... } }.
// Returns the list of requested permission keys the user does NOT hold.
// Anything missing from the response counts as "not held" (fail closed).
export function missingPermissions(data, required = []) {
  const granted = data?.permissions || {};
  return required.filter((key) => granted?.[key]?.havePermission !== true);
}

// Raised when the user (or installation) is not allowed to do something.
export class AccessDeniedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AccessDeniedError";
    this.forbidden = true;
    Object.assign(this, details);
  }
}

// Builds the guard functions around a permission lookup.
//
// `requestMyPermissions(permissions, scope)` must call Jira *as the calling
// user* and resolve to { ok, status, data } where data is the mypermissions
// JSON. `scope` is { issueKey }, { projectKey } or {} for global permissions.
export function createAccessGuards({ requestMyPermissions }) {
  async function lookup(permissions, scope) {
    let result;
    try {
      result = await requestMyPermissions(permissions, scope);
    } catch {
      result = { ok: false, status: 0 };
    }
    // A failed lookup (e.g. 404 for an issue the user cannot see) fails closed.
    if (!result?.ok) return { ok: false, status: result?.status ?? 0, missing: permissions };
    return { ok: true, missing: missingPermissions(result.data, permissions) };
  }

  // Jira administrators only (global ADMINISTER permission).
  async function requireJiraAdmin() {
    const result = await lookup(["ADMINISTER"], {});
    if (!result.ok || result.missing.length) {
      throw new AccessDeniedError("Only Jira administrators can view or change Delivery Manager settings.");
    }
  }

  // The user must hold `permissions` on the issue. When Forge supplies the
  // issue in the module context, the payload must refer to that same issue so
  // a crafted invoke() cannot target a different ticket.
  async function requireIssueAccess(issueKey, context = {}, permissions = ["BROWSE_PROJECTS", "EDIT_ISSUES"]) {
    const key = String(issueKey || "").trim().toUpperCase();
    if (!isValidIssueKey(key)) throw new AccessDeniedError("Invalid or missing Jira issue key.");

    const contextKey = String(context?.extension?.issue?.key || "").trim().toUpperCase();
    if (contextKey && contextKey !== key) {
      throw new AccessDeniedError("The requested issue does not match the issue this action was opened from.");
    }

    const result = await lookup(permissions, { issueKey: key });
    if (!result.ok) throw new AccessDeniedError(`You do not have access to ${key}.`, { status: result.status });
    if (result.missing.length) {
      throw new AccessDeniedError(`You need the ${result.missing.join(" and ")} permission on ${key} to use this action.`);
    }
    return key;
  }

  // The user must hold a project permission (e.g. CREATE_ISSUES).
  async function requireProjectPermission(projectKey, permission) {
    const key = String(projectKey || "").trim();
    const result = key ? await lookup([permission], { projectKey: key }) : { ok: false, missing: [permission] };
    if (!result.ok || result.missing.length) {
      throw new AccessDeniedError(`You need the ${permission} permission in project ${key || "(not configured)"} to use this action.`);
    }
  }

  // Wraps an issue-action resolver. Denials come back as a normal result the
  // issue-action UIs already render ({ ok: false, error }).
  function guardIssueResolver(fn, { permissions } = {}) {
    return async (request) => {
      try {
        await requireIssueAccess(request?.payload?.issueKey, request?.context, permissions);
      } catch (error) {
        if (error instanceof AccessDeniedError) return { ok: false, forbidden: true, error: error.message };
        throw error;
      }
      return fn(request);
    };
  }

  // Wraps an admin-page resolver. Denials reject the invoke() call, which the
  // settings page already surfaces in its status banners.
  function guardAdminResolver(fn) {
    return async (request) => {
      await requireJiraAdmin();
      return fn(request);
    };
  }

  return { requireJiraAdmin, requireIssueAccess, requireProjectPermission, guardIssueResolver, guardAdminResolver };
}

// Settings each feature needs before it does anything. A fresh install has
// none of these set, so every feature stays inert until an admin configures it.
const REQUIRED_SETTINGS = {
  hardwareSync: ["sdProject", "hwProject", "hwDispatchedStatus", "sdDispatchedStatus", "trackingField", "dateSentField"],
  hardwareAutoCreate: ["sdSentStatus", "hwIssueType"],
  dhlTracking: ["sdProject", "sdDispatchedStatus", "trackingField", "deliveryStatusField", "deliveryDateField", "signedForField", "dateSentField", "lastDhlCheckField"],
  hardwareAction: ["sdProject", "hwProject", "hwIssueType"],
  shipmentAction: ["hwProject", "trackingField"],
};

// Returns the setting keys that are still empty for the given feature.
export function missingSettings(config = {}, feature) {
  const keys = REQUIRED_SETTINGS[feature] || [];
  return keys.filter((key) => !String(config?.[key] ?? "").trim());
}
