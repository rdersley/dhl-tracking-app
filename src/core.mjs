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

export function collectStatusStrings(shipment) {
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

export function analyseDHLStatuses(statuses) {
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
