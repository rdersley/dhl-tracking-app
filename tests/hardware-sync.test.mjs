import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDispatchRepair,
  buildHardwareDuplicateState,
  getLinkedIssueKey,
  getLinkedIssueKeys,
} from "../src/hardware-core.mjs";

const config = {
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  sdDispatchedStatus: "Dispatched",
};

test("finds linked SD issue regardless of link direction", () => {
  const issue = {
    fields: {
      issuelinks: [
        { outwardIssue: { key: "OTHER-1" } },
        { inwardIssue: { key: "SD-123" } },
      ],
    },
  };
  assert.equal(getLinkedIssueKey(issue, "SD"), "SD-123");
});

test("finds linked HW issue by project prefix", () => {
  const issue = {
    fields: { issuelinks: [{ outwardIssue: { key: "HW-77" } }] },
  };
  assert.equal(getLinkedIssueKey(issue, "HW"), "HW-77");
});

test("finds all linked HW issues and de-duplicates repeated links", () => {
  const issue = {
    fields: {
      issuelinks: [
        { outwardIssue: { key: "HW-77" } },
        { inwardIssue: { key: "HW-88" } },
        { outwardIssue: { key: "HW-77" } },
        { outwardIssue: { key: "OTHER-1" } },
      ],
    },
  };
  assert.deepEqual(getLinkedIssueKeys(issue, "HW"), ["HW-77", "HW-88"]);
});

test("duplicate state is safe when no HW ticket exists", () => {
  const issue = { fields: { issuelinks: [{ outwardIssue: { key: "OTHER-1" } }] } };
  assert.deepEqual(buildHardwareDuplicateState(issue, "HW"), {
    duplicate: false,
    existingKeys: [],
    linkedKeys: [],
    recordedIssueKey: null,
  });
});

test("duplicate state warns when an HW ticket is already linked", () => {
  const issue = { fields: { issuelinks: [{ outwardIssue: { key: "HW-42" } }] };
  assert.deepEqual(buildHardwareDuplicateState(issue, "HW"), {
    duplicate: true,
    existingKeys: ["HW-42"],
    linkedKeys: ["HW-42"],
    recordedIssueKey: null,
  });
});

test("duplicate state also protects a created ticket whose link failed", () => {
  const issue = { fields: { issuelinks: [] } };
  assert.deepEqual(buildHardwareDuplicateState(issue, "HW", "HW-99"), {
    duplicate: true,
    existingKeys: ["HW-99"],
    linkedKeys: [],
    recordedIssueKey: "HW-99",
  });
});

test("duplicate state ignores a recorded ticket from another project", () => {
  const issue = { fields: { issuelinks: [] } };
  assert.equal(buildHardwareDuplicateState(issue, "HW", "OTHER-9").duplicate, false);
});

test("dispatch repair is not ready without tracking and date sent", () => {
  const hw = { fields: { customfield_10417: "JD001", customfield_10433: null } };
  const sd = { fields: { status: { name: "Sent to Hardware" } } };
  assert.deepEqual(buildDispatchRepair(hw, sd, config), {
    ready: false,
    fields: {},
    transition: false,
  });
});

test("dispatch repair copies missing values and requests SD transition", () => {
  const hw = { fields: { customfield_10417: "JD001", customfield_10433: "2026-08-31" } };
  const sd = {
    fields: {
      customfield_10417: null,
      customfield_10433: null,
      status: { name: "Sent to Hardware" },
    },
  };
  assert.deepEqual(buildDispatchRepair(hw, sd, config), {
    ready: true,
    fields: {
      customfield_10417: "JD001",
      customfield_10433: "2026-08-31",
    },
    transition: true,
  });
});

test("dispatch repair is idempotent when SD is already correct", () => {
  const hw = { fields: { customfield_10417: "JD001", customfield_10433: "2026-08-31" } };
  const sd = {
    fields: {
      customfield_10417: "JD001",
      customfield_10433: "2026-08-31",
      status: { name: "Dispatched" },
    },
  };
  assert.deepEqual(buildDispatchRepair(hw, sd, config), {
    ready: true,
    fields: {},
    transition: false,
  });
});

test("dispatch repair corrects changed HW values without repeating transition", () => {
  const hw = { fields: { customfield_10417: "JD002", customfield_10433: "2026-08-31" } };
  const sd = {
    fields: {
      customfield_10417: "JD001",
      customfield_10433: "2026-08-31",
      status: { name: "Dispatched" },
    },
  };
  assert.deepEqual(buildDispatchRepair(hw, sd, config), {
    ready: true,
    fields: { customfield_10417: "JD002" },
    transition: false,
  });
});
