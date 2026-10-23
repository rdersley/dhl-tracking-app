export function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseJiraDate(raw) {
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

export function currentDropdownValue(fieldValue) {
  if (!fieldValue) return null;
  if (typeof fieldValue === "string") return fieldValue;
  return fieldValue.value ?? null;
}

// DHL returns events newest first, but prefer real timestamps when every
// event has one so an out-of-order response cannot pick a stale event.
export function latestDhlEvent(shipment) {
  const events = (shipment?.events ?? []).filter(Boolean);
  if (!events.length) return null;

  const times = events.map((event) => new Date(event?.timestamp).getTime());
  if (times.some((time) => Number.isNaN(time))) return events[0];

  return events.reduce((latest, event, index) =>
    times[index] > new Date(latest.timestamp).getTime() ? event : latest
  );
}

// Only the current shipment status and the newest event describe where the
// parcel is now. Older history (e.g. a customs clearance days ago) must not
// keep influencing the Jira status.
export function collectStatusStrings(shipment) {
  const values = [];

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
  collect(latestDhlEvent(shipment));

  return values
    .filter((value) => typeof value === "string")
    .map(normalise);
}

// Phrases such as "could not be delivered" or "will be delivered" contain the
// word "delivered" but mean the opposite, so they are removed before matching.
const NEGATED_DELIVERED = [
  /\bnot\s+(?:yet\s+)?(?:been\s+)?delivered\b/g,
  /\bnever\s+(?:been\s+)?delivered\b/g,
  /\bbe\s+delivered\b/g,
];

export function isDeliveredText(status) {
  const text = NEGATED_DELIVERED.reduce((value, pattern) => value.replace(pattern, " "), normalise(status));
  return /\bdelivered\b/.test(text);
}

export function analyseDHLStatuses(statuses) {
  const includesAny = (phrases) =>
    statuses.some((status) =>
      phrases.some((phrase) => status.includes(phrase))
    );

  return {
    delivered: statuses.some(isDeliveredText),
    returnedToSender: includesAny([
      "return to sender",
      "returned to sender",
      "shipment returned",
      "returned to shipper",
    ]),
    deliveryFailed: includesAny([
      "delivery failed",
      "could not be delivered",
      "cannot be delivered",
      "not delivered",
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

export function compareIssuesForFairRotation(a, b, dateSentField, lastCheckField) {
  const aLast = a.fields[lastCheckField];
  const bLast = b.fields[lastCheckField];

  if (!aLast && !bLast) {
    const aSent = parseJiraDate(a.fields[dateSentField]);
    const bSent = parseJiraDate(b.fields[dateSentField]);
    return aSent - bSent;
  }

  if (!aLast) return -1;
  if (!bLast) return 1;

  const lastDifference =
    new Date(aLast).getTime() - new Date(bLast).getTime();

  if (lastDifference !== 0) {
    return lastDifference;
  }

  const aSent = parseJiraDate(a.fields[dateSentField]);
  const bSent = parseJiraDate(b.fields[dateSentField]);
  return aSent - bSent;
}
