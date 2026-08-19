import api, { route } from "@forge/api";

/* -----------------------------
  CONFIGURATION
------------------------------*/

const DHL_API_KEY = "bfinrwdfLsfreFZriaZrMbAeAGTjp12W";
const DHL_URL = "https://api-eu.dhl.com/track/shipments";

const TRACKING_FIELD = "customfield_10417";
const DELIVERY_STATUS_FIELD = "customfield_11952";
const DELIVERY_STATUS_JQL = 'Delivery Status[Dropdown]';

const DELIVERY_DATE_FIELD = "customfield_10434";
const SIGNED_FOR_FIELD = "customfield_10442";
const DATE_SENT_FIELD = "customfield_10433";

const RESOLVED_TRANSITION_ID = 221;

const MIN_DAYS_SINCE_SENT = 3;
const MAX_SEARCH_RESULTS = 100;
const MAX_PER_RUN = 10;
const DELAY_MS = 1500;

/* -----------------------------
  DATE PARSER
------------------------------*/
function parseJiraDate(raw) {
  if (!raw) return null;
  const parts = raw.split(" ");
  if (parts.length === 3) {
    const [day, mon, year] = parts;
    const idx = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(mon);
    if (idx >= 0) return new Date(Number(year), idx, Number(day));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -----------------------------
  DHL API CALL
------------------------------*/
async function getDHL(trackingNumber) {
  try {
    const response = await fetch(
      `${DHL_URL}?trackingNumber=${encodeURIComponent(trackingNumber)}`,
      {
        method: "GET",
        headers: { "DHL-API-Key": DHL_API_KEY },
      }
    );

    if (response.status === 429) return { rateLimited: true };

    if (!response.ok) {
      return {
        error: true,
        status: response.status,
        body: await response.text(),
      };
    }

    return { ok: true, data: await response.json() };
  } catch (e) {
    return { error: true, message: e.message };
  }
}

/* -----------------------------
  MAIN SCHEDULER
------------------------------*/
export async function run() {
  console.log("🔄 DHL Tracking Scheduler started");

  const jql =
    `"Tracking Number" IS NOT EMPTY AND project = SD AND status = "Dispatched to Customer" ` +
    `AND "SD Client[Dropdown]" IN ("RYR - Ryanair","RYS - Buzz","LDA - Lauda ") ` +
    `AND ("${DELIVERY_STATUS_JQL}" IS EMPTY OR "${DELIVERY_STATUS_JQL}" != "Delivered")`;

  console.log("📥 JQL:", JSON.stringify(jql));

  let issues = [];

  try {
    const fieldsParam = [
      TRACKING_FIELD,
      DELIVERY_STATUS_FIELD,
      DELIVERY_DATE_FIELD,
      SIGNED_FOR_FIELD,
      DATE_SENT_FIELD,
    ].join(",");

    const res = await api
      .asApp()
      .requestJira(
        route`/rest/api/3/search/jql?jql=${jql}&maxResults=${MAX_SEARCH_RESULTS}&fields=${fieldsParam}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );

    if (!res.ok) {
      console.log("❌ JIRA SEARCH ERROR:", await res.text());
      return;
    }

    const data = await res.json();
    issues = data.issues ?? [];
  } catch (err) {
    console.log("❌ JIRA SEARCH ERROR(exception):", String(err));
    return;
  }

  console.log(`🔍 Found ${issues.length} issues from JQL`);

  /* FILTER BY DATE SENT */
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - MIN_DAYS_SINCE_SENT);

  issues = issues.filter((issue) => {
    const parsed = parseJiraDate(issue.fields[DATE_SENT_FIELD]);
    if (!parsed) return true;
    return parsed <= cutoff;
  });

  issues.sort((a, b) => {
    const da = parseJiraDate(a.fields[DATE_SENT_FIELD]);
    const db = parseJiraDate(b.fields[DATE_SENT_FIELD]);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  const toProcess = issues.slice(0, MAX_PER_RUN);
  console.log(`⚙️ Processing ${toProcess.length} issues`);

  /* PROCESSING LOOP */
  for (const issue of toProcess) {
    const key = issue.key;
    const fields = issue.fields;
    const tracking = fields[TRACKING_FIELD];

    if (!tracking) continue;

    console.log(`📦 Checking DHL tracking for ${key}: ${tracking}`);
    await sleep(DELAY_MS);

    const dhl = await getDHL(tracking);

    if (dhl.rateLimited) {
      console.log(`⏱️ DHL rate limit hit while processing ${key}`);
      break;
    }

    if (!dhl.ok) continue;

    const shipment = dhl.data?.shipments?.[0];
    const events = shipment?.events ?? [];

    const statusStrings = [];

    const collect = (obj) => {
      if (!obj) return;
      if (obj.status) statusStrings.push(obj.status);
      if (obj.statusCode) statusStrings.push(obj.statusCode);
      if (obj.description) statusStrings.push(obj.description);
    };

    collect(shipment?.status);
    events.forEach((ev) => collect(ev));

    const statuses = statusStrings
      .filter((s) => typeof s === "string")
      .map((s) => s.toLowerCase());

    console.log(
      `📬 DHL status strings for ${key}: ${JSON.stringify(statuses)}`
    );

    /* -----------------------------
       DHL → Jira status flags
    ------------------------------*/
    const delivered = statuses.some((s) => s.includes("delivered"));

    const returnedToSender = statuses.some(
      (s) =>
        s.includes("return to sender") ||
        s.includes("returned to sender") ||
        s.includes("shipment returned") ||
        s.includes("returned to shipper")
    );

    const customsDelay = statuses.some(
      (s) => s.includes("customs") || s.includes("clearance event")
    );

    const exceptionOnHold = statuses.some(
      (s) =>
        s.includes("exception") ||
        s.includes("on hold") ||
        s.includes("held at") ||
        s.includes("awaiting collection")
    );

    const attempted = statuses.some(
      (s) =>
        s.includes("attempted") ||
        s.includes("delivery attempt") ||
        s.includes("attempt") ||
        s.includes("recipient not home") ||
        s.includes("consignee not available")
    );

    const outForDelivery = statuses.some(
      (s) =>
        s.includes("out for delivery") ||
        s.includes("with delivery courier") ||
        s.includes("with courier")
    );

    const inTransit = statuses.some(
      (s) =>
        s.includes("transit") ||
        s.includes("processed") ||
        s.includes("departed") ||
        s.includes("sorted") ||
        s.includes("facility")
    );

    const latest = events[0];

    /* ================================
       DELIVERY HANDLING (Delivered)
    =================================*/
    if (delivered) {
      const update = {};
      update[DELIVERY_STATUS_FIELD] = { value: "Delivered" };
      update[DELIVERY_DATE_FIELD] =
        latest?.timestamp?.split("T")[0] ?? null;

      let signedFor =
        shipment?.proofOfDelivery?.recipientName ||
        latest?.receiverName ||
        latest?.signature ||
        null;

      if (!signedFor) {
        signedFor = "Unknown";
      }

      update[SIGNED_FOR_FIELD] = signedFor;

      console.log(`✅ ${key} delivered → updating fields & transitioning`);

      /* UPDATE FIELDS */
      const updateRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${key}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: update }),
        }
      );

      if (!updateRes.ok) {
        console.log(
          `❌ Failed field update for ${key}: ${await updateRes.text()}`
        );
        continue;
      }

      /* ADD INTERNAL COMMENT */
      const commentText = [
        "*📦 DHL Delivery Update (Automated)*",
        "",
        `• **Delivered:** ${
          update[DELIVERY_DATE_FIELD] ?? "Unknown date"
        }`,
        `• **Signed for by:** ${signedFor}`,
        "",
        "_This update was applied automatically by DHL tracking integration._",
      ].join("\n");

      try {
        const commentBody = {
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: commentText }],
              },
            ],
          },
        };

        const commentRes = await api.asApp().requestJira(
          route`/rest/api/3/issue/${key}/comment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(commentBody),
          }
        );

        if (!commentRes.ok) {
          console.log(
            `⚠️ Failed to add comment for ${key}: ${await commentRes.text()}`
          );
        } else {
          // Make the comment INTERNAL (JSM internal note)
          try {
            const commentJson = await commentRes.json();
            const commentId = commentJson.id;

            const propRes = await api.asApp().requestJira(
              route`/rest/api/3/issue/${key}/comment/${commentId}/properties/sd.public.comment`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ internal: true }),
              }
            );

            if (!propRes.ok) {
              console.log(
                `⚠️ Failed to set comment internal for ${key}: ${await propRes.text()}`
              );
            }
          } catch (e) {
            console.log(
              `⚠️ Error setting comment internal for ${key}: ${String(e)}`
            );
          }
        }
      } catch (e) {
        console.log(
          `⚠️ Failed to add comment for ${key}: ${String(e)}`
        );
      }

      /* TRANSITION TO RESOLVED (if configured) */
      try {
        const tRes = await api.asApp().requestJira(
          route`/rest/api/3/issue/${key}/transitions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transition: { id: RESOLVED_TRANSITION_ID },
            }),
          }
        );

        if (!tRes.ok) {
          console.log(
            `❌ Failed to transition ${key}: ${await tRes.text()}`
          );
        }
      } catch (e) {
        console.log(
          `⚠️ Transition error for ${key}: ${String(e)}`
        );
      }

      continue;
    }

    /* ================================
       NON-Delivered Status Mapping
    =================================*/
    let newStatusValue = null;

    if (returnedToSender) {
      newStatusValue = "Returned to Sender";
    } else if (customsDelay) {
      newStatusValue = "Customs Delay";
    } else if (exceptionOnHold) {
      newStatusValue = "Exception / On Hold";
    } else if (attempted) {
      newStatusValue = "Attempted";
    } else if (outForDelivery) {
      newStatusValue = "Out for Delivery";
    } else if (inTransit) {
      newStatusValue = "In Transit";
    }

    if (newStatusValue) {
      const current =
        fields[DELIVERY_STATUS_FIELD]?.value || null;

      if (current !== newStatusValue) {
        console.log(
          `🚚 ${key} → setting Delivery Status to "${newStatusValue}"`
        );

        const res = await api.asApp().requestJira(
          route`/rest/api/3/issue/${key}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields: {
                [DELIVERY_STATUS_FIELD]: { value: newStatusValue },
              },
            }),
          }
        );

        if (!res.ok) {
          console.log(
            `❌ Failed to update Delivery Status for ${key}: ${await res.text()}`
          );
        }
      }

      continue;
    }

    console.log(
      `ℹ️ ${key} DHL status not mapped to Jira Delivery Status`
    );
  }

  console.log("✅ Scheduler complete");
}
