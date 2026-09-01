function quoteJql(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function customFieldNumber(fieldId) {
  const match = String(fieldId || "").match(/^customfield_(\d+)$/);
  return match ? match[1] : null;
}

export function buildEligibleIssueJql(config) {
  const trackingNo = customFieldNumber(config.trackingField);
  const deliveryNo = customFieldNumber(config.deliveryStatusField);
  const lastCheckNo = customFieldNumber(config.lastDhlCheckField);
  const dateSentNo = customFieldNumber(config.dateSentField);
  if (!trackingNo || !deliveryNo || !lastCheckNo || !dateSentNo) {
    throw new Error("Tracking, Delivery Status, Last DHL Check and Date Sent must be custom fields");
  }

  const statuses = [
    config.sdDispatchedStatus,
    config.outForDeliveryStatus,
    config.awaitingCollectionStatus,
    config.onHoldStatus,
  ].filter(Boolean).map(quoteJql).join(", ");

  const parts = [
    `project = ${quoteJql(config.sdProject)}`,
    `cf[${trackingNo}] IS NOT EMPTY`,
    `status IN (${statuses})`,
    `(cf[${deliveryNo}] IS EMPTY OR cf[${deliveryNo}] != ${quoteJql(config.deliveredValue || "Delivered")})`,
  ];

  if (config.clientRestrictionEnabled) {
    const clientNo = customFieldNumber(config.clientField);
    const values = Array.isArray(config.clientValues) ? config.clientValues.filter(Boolean) : [];
    if (!clientNo || !values.length) {
      throw new Error("Client restrictions are enabled but Client field/values are not fully configured");
    }
    parts.push(`cf[${clientNo}] IN (${values.map(quoteJql).join(", ")})`);
  }

  parts.push(`ORDER BY cf[${lastCheckNo}] ASC, cf[${dateSentNo}] ASC`);
  return parts.join(" AND ").replace(" AND ORDER BY", " ORDER BY");
}

export function deliveryDecision(analysis, config) {
  if (analysis.returnedToSender || analysis.deliveryFailed) {
    return { workflowStatus: config.failedStatus, deliveryStatus: config.failedValue || "Delivery Failed" };
  }
  if (analysis.awaitingCollection) {
    return { workflowStatus: config.awaitingCollectionStatus, deliveryStatus: config.awaitingCollectionValue || "Awaiting Collection" };
  }
  if (analysis.onHold) {
    return { workflowStatus: config.onHoldStatus, deliveryStatus: config.onHoldValue || "On Hold" };
  }
  if (analysis.outForDelivery) {
    return { workflowStatus: config.outForDeliveryStatus, deliveryStatus: config.outForDeliveryValue || "Out for Delivery" };
  }
  if (analysis.inTransit) {
    return { workflowStatus: null, deliveryStatus: config.inTransitValue || "In Transit" };
  }
  return { workflowStatus: null, deliveryStatus: null };
}

export function safeDhlRuntimeConfig(config) {
  return {
    ...config,
    maxResults: Math.max(1, Math.min(100, Number(config.maxResults || 100))),
    dhlBatchSize: Math.max(1, Math.min(50, Number(config.dhlBatchSize || 10))),
    dhlDelayMs: Math.max(1000, Math.min(15000, Number(config.dhlDelayMs || 3000))),
    minDaysSinceSent: Math.max(0, Math.min(30, Number(config.minDaysSinceSent ?? 3))),
  };
}
