import api, { route } from "@forge/api";

/* =========================================================
   DHL TRACKING APP v5
   - Dynamic Jira transitions by destination status name
   - Fair rotation using Last DHL Check
   - DHL → Jira workflow status mapping
   - Internal JSM comments
   ========================================================= */

/* -----------------------------
   CONFIGURATION
------------------------------ */

const DHL_API_KEY = process.env.DHL_API_KEY;
const DHL_URL = "https://api-eu.dhl.com/track/shipments";

const PROJECT_KEY = "SD";

const TRACKING_FIELD = "customfield_10417";
const DELIVERY_STATUS_FIELD = "customfield_11952";
const DELIVERY_DATE_FIELD = "customfield_10434";
const SIGNED_FOR_FIELD = "customfield_10442";
const DATE_SENT_FIELD = "customfield_10433";
const LAST_DHL_CHECK_FIELD = "customfield_14400";

const DELIVERY_STATUS_JQL = "Delivery Status[Dropdown]";

const MIN_DAYS_SINCE_SENT = 3;
const MAX_SEARCH_RESULTS = 100;
const MAX_PER_RUN = 10;
const DELAY_MS = 3000;

const JIRA_STATUS = {
  DISPATCHED: "Dispatched to Customer",
  OUT_FOR_DELIVERY: "OUT FOR DELIVERY",
  AWAITING_COLLECTION: "DELIVERY AWAITING COLLECTION",
  ON_HOLD: "DELIVERY ON HOLD",
  FAILED: "DELIVERY FAILED",
  RESOLVED: "Resolved",
};

/* -----------------------------
   GENERIC HELPERS
------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseJiraDate(raw) {
  if (!raw || typeof raw !== "string") return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`);
  }

  const parts = raw.split(" ");
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const monthIndex = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ].indexOf(month);

    if (monthIndex >= 0) {
      return new Date(Date.UTC(Number(year), monthIndex, Number(day)));
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function currentDropdownValue(fieldValue) {
  if (!fieldValue) return null;
  if (typeof fieldValue === "string") return fieldValue;
  return fieldValue.value ?? null;
}

/* -----------------------------
   DHL API
------------------------------ */

async function getDHL(trackingNumber) {
  try {
    const response = await fetch(
      `${DHL_URL}?trackingNumber=${encodeURIComponent(trackingNumber)}`,
      {
        method: "GET",
        headers: {
          "DHL-API-Key": DHL_API_KEY,
          Accept: "application/json",
        },
      }
    );

    if (response.status === 429) {
      return {
        rateLimited: true,
        retryAfter: response.headers.get("Retry-After"),
      };
    }

    if (!response.ok) {
      return {
        error: true,
        status: response.status,
        body: await response.text(),
      };
    }

    return {
      ok: true,
      data: await response.json(),
    };
  } catch (error) {
    return {
      error: true,
      message: String(error),
    };
  }
}

/* -----------------------------
   JIRA HELPERS
------------------------------ */

async function updateIssueFields(issueKey, fields) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!response.ok) {
    console.log(
      `❌ Failed to update fields on ${issueKey}: ${await response.text()}`
    );
    return false;
  }

  return true;
}

async function addInternalComment(issueKey, text) {
  try {
    const response = await api.asApp().requestJira(
      route`/rest/servicedeskapi/request/${issueKey}/comment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          public: false,
          body: text,
        }),
      }
    );

    if (!response.ok) {
      console.log(
        `⚠️ Failed to add internal comment to ${issueKey}: ${await response.text()}`
      );
      return false;
    }

    console.log(`📝 Internal DHL note added to ${issueKey}`);
    return true;
  } catch (error) {
    console.log(
      `⚠️ Internal comment error for ${issueKey}: ${String(error)}`
    );
    return false;
  }
}

async function getAvailableTransitions(issueKey) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  if (!response.ok) {
    console.log(
      `❌ Could not retrieve transitions for ${issueKey}: ${await response.text()}`
    );
    return [];
  }

  const data = await response.json();
  return data.transitions ?? [];
}

async function transitionToStatus(
  issueKey,
  targetStatusName,
  resolutionName = null
) {
  try {
    const transitions = await getAvailableTransitions(issueKey);
    const target = normalise(targetStatusName);

    const match = transitions.find(
      (transition) => normalise(transition.to?.name) === target
    );

    if (!match) {
      const available = transitions
        .map((transition) => transition.to?.name)
        .filter(Boolean)
        .join(", ");

      console.log(
        `⚠️ ${issueKey} cannot transition to "${targetStatusName}". ` +
        `Available destinations: ${available || "none"}`
      );
      return false;
    }

    const payload = {
      transition: {
        id: match.id,
      },
    };

    if (resolutionName) {
      payload.fields = {
        resolution: {
          name: resolutionName,
        },
      };
    }

    const response = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/transitions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.log(
        `❌ Failed to transition ${issueKey} to "${targetStatusName}": ` +
        `${await response.text()}`
      );
      return false;
    }

    console.log(
      `✅ ${issueKey} transitioned to "${targetStatusName}" ` +
      `using transition ${match.id}`
    );
    return true;
  } catch (error) {
    console.log(
      `❌ Transition error for ${issueKey}: ${String(error)}`
    );
    return false;
  }
}

/* -----------------------------
   DHL STATUS ANALYSIS
------------------------------ */

function collectStatusStrings(shipment) {
  const values = [];
  const events = shipment?.events ?? [];

  const collect = (item) => {
    if (!item) return;

    if (typeof item === "string") {
      values.push(item);
      return;
    }

    if (item.status) values.push(item.status);
    if (item.statusCode) values.push(item.statusCode);
    if (item.description) values.push(item.description);
  };

  collect(shipment?.status);
  events.forEach(collect);

  return values
    .filter((value) => typeof value === "string")
    .map(normalise);
}

function analyseDHLStatuses(statuses) {
  const includesAny = (phrases) =>
    statuses.some((status) =>
      phrases.some((phrase) => status.includes(phrase))
    );

  return {
    delivered: includesAny(["delivered"]),
    returnedToSender: includesAny([
      "return to sender",
      "returned to sender",
      "shipment returned",
      "returned to shipper",
    ]),
    deliveryFailed: includesAny([
      "delivery failed",
      "delivery attempt could not be completed",
      "delivery attempted but no response",
      "recipient not home",
      "consignee not available",
      "incorrect address",
      "address information needed",
    ]),
    awaitingCollection: includesAny([
      "awaiting collection",
      "collection by the consignee",
      "ready for collection",
    ]),
    onHold: includesAny([
      "on hold",
      "held at",
      "customs",
      "clearance event",
      "exception",
    ]),
    outForDelivery: includesAny([
      "out for delivery",
      "out with courier",
      "with delivery courier",
      "with courier for delivery",
      "scheduled for delivery",
    ]),
    inTransit: includesAny([
      "in transit",
      "transit",
      "processed",
      "departed",
      "sorted",
      "facility",
      "picked up",
    ]),
  };
}

/* -----------------------------
   ISSUE SEARCH
------------------------------ */

async function searchEligibleIssues() {
  const statuses = [
    JIRA_STATUS.DISPATCHED,
    JIRA_STATUS.OUT_FOR_DELIVERY,
    JIRA_STATUS.AWAITING_COLLECTION,
    JIRA_STATUS.ON_HOLD,
  ]
    .map((status) => `"${status}"`)
    .join(", ");

  const jql =
    `"Tracking Number" IS NOT EMPTY ` +
    `AND project = ${PROJECT_KEY} ` +
    `AND status IN (${statuses}) ` +
    `AND "SD Client[Dropdown]" IN (` +
      `"RYR - Ryanair", "RYS - Buzz", "LDA - Lauda "` +
    `) ` +
    `AND ("${DELIVERY_STATUS_JQL}" IS EMPTY ` +
      `OR "${DELIVERY_STATUS_JQL}" != "Delivered") ` +
    `ORDER BY "Last DHL Check" ASC, "Date Sent[Date]" ASC`;

  console.log("📥 JQL:", jql);

  const fields = [
    TRACKING_FIELD,
    DELIVERY_STATUS_FIELD,
    DELIVERY_DATE_FIELD,
    SIGNED_FOR_FIELD,
    DATE_SENT_FIELD,
    LAST_DHL_CHECK_FIELD,
    "status",
  ].join(",");

  const response = await api.asApp().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fields}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data.issues ?? [];
}

/* -----------------------------
   DELIVERED HANDLING
------------------------------ */

async function handleDelivered(issueKey, shipment) {
  const events = shipment?.events ?? [];
  const latest = events[0];

  const deliveredDate = latest?.timestamp?.split("T")[0] ?? null;

  const signedFor =
    shipment?.proofOfDelivery?.recipientName ||
    latest?.receiverName ||
    latest?.signature ||
    "Unknown";

  const fields = {
    [DELIVERY_STATUS_FIELD]: { value: "Delivered" },
    [SIGNED_FOR_FIELD]: signedFor,
  };

  if (deliveredDate) {
    fields[DELIVERY_DATE_FIELD] = deliveredDate;
  }

  console.log(`✅ ${issueKey} delivered`);

  const updated = await updateIssueFields(issueKey, fields);
  if (!updated) return;

  const comment = [
    "📦 DHL Delivery Update (Automated)",
    "",
    `Delivered: ${deliveredDate ?? "Unknown date"}`,
    `Signed for by: ${signedFor}`,
    "",
    "This update was applied automatically by the DHL tracking integration.",
  ].join("\n");

  await addInternalComment(issueKey, comment);

  const transitioned = await transitionToStatus(
    issueKey,
    JIRA_STATUS.RESOLVED,
    "Done"
  );

  if (!transitioned) {
    console.log(
      `⚠️ ${issueKey} was updated as Delivered but was not moved to Resolved`
    );
  }
}

/* -----------------------------
   NON-DELIVERED HANDLING
------------------------------ */

async function handleNonDelivered(issue, analysis) {
  const issueKey = issue.key;
  const currentDeliveryStatus = currentDropdownValue(
    issue.fields[DELIVERY_STATUS_FIELD]
  );

  let targetWorkflowStatus = null;
  let targetDeliveryStatus = null;

  if (analysis.returnedToSender || analysis.deliveryFailed) {
    targetWorkflowStatus = JIRA_STATUS.FAILED;
    targetDeliveryStatus = "Delivery Failed";
  } else if (analysis.awaitingCollection) {
    targetWorkflowStatus = JIRA_STATUS.AWAITING_COLLECTION;
    targetDeliveryStatus = "Awaiting Collection";
  } else if (analysis.onHold) {
    targetWorkflowStatus = JIRA_STATUS.ON_HOLD;
    targetDeliveryStatus = "On Hold";
  } else if (analysis.outForDelivery) {
    targetWorkflowStatus = JIRA_STATUS.OUT_FOR_DELIVERY;
    targetDeliveryStatus = "Out for Delivery";
  } else if (analysis.inTransit) {
    targetDeliveryStatus = "In Transit";
  }

  if (targetDeliveryStatus && currentDeliveryStatus !== targetDeliveryStatus) {
    console.log(`🚚 ${issueKey} Delivery Status → "${targetDeliveryStatus}"`);
    await updateIssueFields(issueKey, {
      [DELIVERY_STATUS_FIELD]: { value: targetDeliveryStatus },
    });
  }

  if (targetWorkflowStatus) {
    await transitionToStatus(issueKey, targetWorkflowStatus);
  } else {
    console.log(`ℹ️ ${issueKey} remains in its current Jira workflow status`);
  }
}

/* -----------------------------
   MAIN SCHEDULER
------------------------------ */

export async function run() {
  if (!DHL_API_KEY) {
    console.log("❌ DHL_API_KEY is not configured.");
    return;
  }

  console.log("==============================================");
  console.log("DHL Tracking App v5");
  console.log(`Batch size ${MAX_PER_RUN}, delay ${DELAY_MS}ms`);
  console.log("Dynamic workflow transitions enabled");
  console.log("==============================================");

  let issues;

  try {
    issues = await searchEligibleIssues();
  } catch (error) {
    console.log(`❌ Jira search failed: ${String(error)}`);
    return;
  }

  console.log(`🔍 Found ${issues.length} eligible issue(s)`);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - MIN_DAYS_SINCE_SENT);

  issues = issues.filter((issue) => {
    const dateSent = parseJiraDate(issue.fields[DATE_SENT_FIELD]);

    if (!dateSent) {
      console.log(`⏭️ Skipping ${issue.key}: Date Sent is missing or invalid`);
      return false;
    }

    return dateSent <= cutoff;
  });

  issues.sort((a, b) => {
    const aLast = a.fields[LAST_DHL_CHECK_FIELD];
    const bLast = b.fields[LAST_DHL_CHECK_FIELD];

    if (!aLast && !bLast) {
      const aSent = parseJiraDate(a.fields[DATE_SENT_FIELD]);
      const bSent = parseJiraDate(b.fields[DATE_SENT_FIELD]);
      return aSent - bSent;
    }

    if (!aLast) return -1;
    if (!bLast) return 1;

    const lastDifference =
      new Date(aLast).getTime() - new Date(bLast).getTime();

    if (lastDifference !== 0) return lastDifference;

    const aSent = parseJiraDate(a.fields[DATE_SENT_FIELD]);
    const bSent = parseJiraDate(b.fields[DATE_SENT_FIELD]);
    return aSent - bSent;
  });

  const toProcess = issues.slice(0, MAX_PER_RUN);

  console.log(
    `⚙️ Processing ${toProcess.length} issue(s): ` +
    toProcess.map((issue) => issue.key).join(", ")
  );

  for (const issue of toProcess) {
    const issueKey = issue.key;
    const trackingNumber = issue.fields[TRACKING_FIELD];

    if (!trackingNumber) {
      console.log(`⏭️ Skipping ${issueKey}: no tracking number`);
      continue;
    }

    console.log(`📦 Checking ${issueKey}: ${trackingNumber}`);

    await sleep(DELAY_MS);

    const dhl = await getDHL(trackingNumber);

    if (dhl.rateLimited) {
      console.log(
        `⏱️ DHL rate limit reached. Retry-After: ${dhl.retryAfter ?? "unknown"}`
      );
      break;
    }

    // Any completed non-429 attempt counts as a check. This prevents a bad/410
    // tracking number from permanently staying at the front of the fair queue.
    await updateIssueFields(issueKey, {
      [LAST_DHL_CHECK_FIELD]: new Date().toISOString(),
    });

    if (!dhl.ok) {
      console.log(
        `⚠️ DHL request failed for ${issueKey}: ` +
        `${dhl.status ?? ""} ${dhl.body ?? dhl.message ?? ""}`
      );
      continue;
    }

    const shipment = dhl.data?.shipments?.[0];

    if (!shipment) {
      console.log(`⚠️ No DHL shipment returned for ${issueKey}`);
      continue;
    }

    const statuses = collectStatusStrings(shipment);

    console.log(`📬 ${issueKey} DHL statuses: ${JSON.stringify(statuses)}`);

    const analysis = analyseDHLStatuses(statuses);

    if (analysis.delivered) {
      await handleDelivered(issueKey, shipment);
      continue;
    }

    await handleNonDelivered(issue, analysis);
  }

  console.log("✅ DHL scheduler complete");
}
