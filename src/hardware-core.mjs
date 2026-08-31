export function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getLinkedIssueKey(issue, projectKey) {
  const prefix = `${String(projectKey).toUpperCase()}-`;
  for (const link of issue?.fields?.issuelinks ?? []) {
    const candidates = [link.inwardIssue, link.outwardIssue].filter(Boolean);
    const match = candidates.find((candidate) =>
      String(candidate.key || "").toUpperCase().startsWith(prefix)
    );
    if (match) return match.key;
  }
  return null;
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
