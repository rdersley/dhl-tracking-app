import test from "node:test";
import assert from "node:assert/strict";
import {
  AccessDeniedError,
  createAccessGuards,
  isValidIssueKey,
  missingPermissions,
  missingSettings,
} from "../src/access-core.mjs";

// Fake mypermissions lookup: `grants` maps a scope string to the permission
// keys the user holds there. Every call is recorded so tests can assert on it.
function fakeJira(grants = {}, { failStatus = null } = {}) {
  const calls = [];
  const requestMyPermissions = async (permissions, scope) => {
    calls.push({ permissions, scope });
    if (failStatus) return { ok: false, status: failStatus };
    const scopeKey = scope.issueKey ? `issue:${scope.issueKey}` : scope.projectKey ? `project:${scope.projectKey}` : "global";
    const held = grants[scopeKey] || [];
    const data = { permissions: Object.fromEntries(permissions.map((key) => [key, { key, havePermission: held.includes(key) }])) };
    return { ok: true, status: 200, data };
  };
  return { calls, guards: createAccessGuards({ requestMyPermissions }) };
}

test("validates Jira issue keys", () => {
  assert.equal(isValidIssueKey("HW-12"), true);
  assert.equal(isValidIssueKey("sd-9"), true);
  assert.equal(isValidIssueKey(""), false);
  assert.equal(isValidIssueKey("HW-0"), false);
  assert.equal(isValidIssueKey("../rest/api/3/myself"), false);
  assert.equal(isValidIssueKey("HW-1 OR project = X"), false);
});

test("treats permissions missing from the Jira response as not held", () => {
  const data = { permissions: { BROWSE_PROJECTS: { havePermission: true } } };
  assert.deepEqual(missingPermissions(data, ["BROWSE_PROJECTS", "EDIT_ISSUES"]), ["EDIT_ISSUES"]);
  assert.deepEqual(missingPermissions(null, ["ADMINISTER"]), ["ADMINISTER"]);
});

test("issue resolver runs only when the user can browse and edit the issue", async () => {
  const { guards, calls } = fakeJira({ "issue:HW-5": ["BROWSE_PROJECTS", "EDIT_ISSUES"] });
  let ran = false;
  const handler = guards.guardIssueResolver(async () => { ran = true; return { ok: true }; }, { permissions: ["BROWSE_PROJECTS", "EDIT_ISSUES"] });
  const result = await handler({ payload: { issueKey: "hw-5" }, context: { extension: { issue: { key: "HW-5" } } } });
  assert.deepEqual(result, { ok: true });
  assert.equal(ran, true);
  assert.deepEqual(calls, [{ permissions: ["BROWSE_PROJECTS", "EDIT_ISSUES"], scope: { issueKey: "HW-5" } }]);
});

test("issue resolver refuses a user without EDIT_ISSUES and never runs the action", async () => {
  const { guards } = fakeJira({ "issue:HW-5": ["BROWSE_PROJECTS"] });
  let ran = false;
  const handler = guards.guardIssueResolver(async () => { ran = true; }, { permissions: ["BROWSE_PROJECTS", "EDIT_ISSUES"] });
  const result = await handler({ payload: { issueKey: "HW-5" }, context: {} });
  assert.equal(ran, false);
  assert.equal(result.ok, false);
  assert.equal(result.forbidden, true);
  assert.match(result.error, /EDIT_ISSUES/);
});

test("issue resolver refuses when Jira cannot resolve the user's permissions (fail closed)", async () => {
  const { guards } = fakeJira({}, { failStatus: 404 });
  let ran = false;
  const handler = guards.guardIssueResolver(async () => { ran = true; });
  const result = await handler({ payload: { issueKey: "HW-5" }, context: {} });
  assert.equal(ran, false);
  assert.equal(result.forbidden, true);
});

test("issue resolver refuses a payload issue that differs from the module context", async () => {
  const { guards, calls } = fakeJira({ "issue:HW-6": ["BROWSE_PROJECTS", "EDIT_ISSUES"] });
  const handler = guards.guardIssueResolver(async () => ({ ok: true }));
  const result = await handler({ payload: { issueKey: "HW-6" }, context: { extension: { issue: { key: "HW-5" } } } });
  assert.equal(result.forbidden, true);
  assert.equal(calls.length, 0);
});

test("issue resolver refuses a missing or malformed issue key without calling Jira", async () => {
  const { guards, calls } = fakeJira();
  const handler = guards.guardIssueResolver(async () => ({ ok: true }));
  assert.equal((await handler({ payload: {}, context: {} })).forbidden, true);
  assert.equal((await handler({ payload: { issueKey: "HW-1/../../x" }, context: {} })).forbidden, true);
  assert.equal(calls.length, 0);
});

test("admin resolver runs only for Jira administrators", async () => {
  const admin = fakeJira({ global: ["ADMINISTER"] });
  const handler = admin.guards.guardAdminResolver(async () => "config");
  assert.equal(await handler({ payload: {} }), "config");
  assert.deepEqual(admin.calls, [{ permissions: ["ADMINISTER"], scope: {} }]);

  const user = fakeJira({ global: [] });
  let ran = false;
  const denied = user.guards.guardAdminResolver(async () => { ran = true; });
  await assert.rejects(() => denied({ payload: {} }), AccessDeniedError);
  assert.equal(ran, false);
});

test("admin resolver fails closed when the permission lookup throws", async () => {
  const guards = createAccessGuards({ requestMyPermissions: async () => { throw new Error("network"); } });
  await assert.rejects(() => guards.guardAdminResolver(async () => "x")({}), AccessDeniedError);
});

test("project permission check requires a configured project", async () => {
  const { guards } = fakeJira({ "project:HW": ["CREATE_ISSUES"] });
  await guards.requireProjectPermission("HW", "CREATE_ISSUES");
  await assert.rejects(() => guards.requireProjectPermission("OPS", "CREATE_ISSUES"), AccessDeniedError);
  await assert.rejects(() => guards.requireProjectPermission("", "CREATE_ISSUES"), AccessDeniedError);
});

test("an empty configuration leaves every feature unconfigured", () => {
  for (const feature of ["hardwareSync", "hardwareAutoCreate", "dhlTracking", "hardwareAction", "shipmentAction"]) {
    assert.ok(missingSettings({}, feature).length > 0, feature);
  }
  assert.deepEqual(missingSettings({ hwProject: "HW", trackingField: "customfield_1" }, "shipmentAction"), []);
});
