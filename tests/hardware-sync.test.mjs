import test from "node:test";
import assert from "node:assert/strict";
import { buildDispatchRepair, getLinkedIssueKey } from "../src/hardware-sync.js";

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
