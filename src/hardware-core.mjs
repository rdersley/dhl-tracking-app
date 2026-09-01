export function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getLinkedIssueKeys(issue, projectKey) {
  const prefix = `${String(projectKey).toUpperCase()}-`;
  const keys = new Set();
  for (const link of issue?.fields?.issuelinks ?? []) {
    const candidates = [link.inwardIssue, link.outwardIssue].filter(Boolean);
    for (const candidate of candidates) {
      const key = String(candidate?.key || "");
      if (key.toUpperCase().startsWith(prefix)) keys.add(key);
    }
  }
  return [...keys];
}

export function getLinkedIssueKey(issue, projectKey) {
  return getLinkedIssueKeys(issue, projectKey)[0] ?? null;
}

export function buildHardwareDuplicateState(issue, projectKey, recordedIssueKey = null) {
  const linkedKeys = getLinkedIssueKeys(issue, projectKey);
  const keys = new Set(linkedKeys);
  const recorded = String(recordedIssueKey || "").trim();
  const prefix = `${String(projectKey).toUpperCase()}-`;
  if (recorded && recorded.toUpperCase().startsWith(prefix)) keys.add(recorded);
  const existingKeys = [...keys];
  return {
    duplicate: existingKeys.length > 0,
    existingKeys,
    linkedKeys,
    recordedIssueKey: recorded || null,
  };
}

export function buildDispatchRepair(hwIssue, sdIssue, config) {
  const tracking = hwIssue?.fields?.[config.trackingField] ?? null;
  const dateSent = hwIssue?.fields?.[config.dateSentField] ?? null;
  if (!tracking || !dateSent) {
    return { ready: false, fields: {}, transition: false };
  }

  const fields = {};
  if (sdIssue?.fields?.[config.trackingField] !== tracking) {
    fields[config.trackingField] = tracking;
  }
  if (sdIssue?.fields?.[config.dateSentField] !== dateSent) {
    fields[config.dateSentField] = dateSent;
  }

  const transition =
    normalise(sdIssue?.fields?.status?.name) !== normalise(config.sdDispatchedStatus);

  return { ready: true, fields, transition };
}
