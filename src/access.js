// Forge wiring for the authorisation and licence guards in access-core.mjs.
//
// The resolvers call Jira with api.asApp(), which uses the app's own (broad)
// permissions. Forge does not check what the *calling user* may do in that
// case, so every resolver must check explicitly before acting. We ask Jira as
// the user (api.asUser()) via /rest/api/3/mypermissions and refuse the request
// unless the required permissions are held.

import api, { route, getAppContext } from "@forge/api";
import { AccessDeniedError, createAccessGuards, licenceState } from "./access-core.mjs";

async function requestMyPermissions(permissions, scope = {}) {
  const list = permissions.join(",");
  let path;
  if (scope.issueKey) path = route`/rest/api/3/mypermissions?issueKey=${scope.issueKey}&permissions=${list}`;
  else if (scope.projectKey) path = route`/rest/api/3/mypermissions?projectKey=${scope.projectKey}&permissions=${list}`;
  else path = route`/rest/api/3/mypermissions?permissions=${list}`;

  const response = await api.asUser().requestJira(path, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, status: response.status, data: await response.json() };
}

export { AccessDeniedError, licenceState };
export const {
  requireJiraAdmin,
  requireIssueAccess,
  requireProjectPermission,
  requireActiveLicence,
  guardIssueResolver,
  guardAdminResolver,
} = createAccessGuards({ requestMyPermissions });

// Scheduled triggers have no resolver context, so read the licence from the
// trigger's own context (when present) or from getAppContext().
export function schedulerLicenceState(triggerContext = {}) {
  let appContext = {};
  try {
    appContext = getAppContext() || {};
  } catch {
    appContext = {};
  }
  return licenceState({
    environmentType: triggerContext?.environmentType || appContext?.environmentType,
    license: triggerContext?.license || appContext?.license,
  });
}
