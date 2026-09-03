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

export function normaliseRecordedHardwareKeys(recorded) {
  if (Array.isArray(recorded)) {
    return [...new Set(recorded.map((key) => String(key || "").trim()).filter(Boolean))];
  }
  const single = String(recorded || "").trim();
  return single ? [single] : [];
}

export function buildHardwareDuplicateState(issue, projectKey, recordedIssueKeys = []) {
  const linkedKeys = getLinkedIssueKeys(issue, projectKey);
  const keys = new Set(linkedKeys);
  const prefix = `${String(projectKey).toUpperCase()}-`;
  const recordedKeys = normaliseRecordedHardwareKeys(recordedIssueKeys)
    .filter((key) => key.toUpperCase().startsWith(prefix));

  for (const key of recordedKeys) keys.add(key);

  const existingKeys = [...keys];
  return {
    duplicate: existingKeys.length > 0,
    existingKeys,
    linkedKeys,
    recordedIssueKeys: recordedKeys,
    recordedIssueKey: recordedKeys[0] || null,
  };
}

export function buildMappedHardwareFields(sourceIssue, config) {
  const fields = {};
  const mappings = Array.isArray(config?.hwFieldMappings) ? config.hwFieldMappings : [];
  for (const mapping of mappings) {
    const source = String(mapping?.source || "").trim();
    const target = String(mapping?.target || "").trim();
    if (!source || !target || ["project", "issuetype", "summary", "description"].includes(target)) continue;
    const value = sourceIssue?.fields?.[source];
    if (value !== undefined && value !== null && value !== "") fields[target] = value;
  }
  return fields;
}

export function buildHardwareCreateFields(sourceIssue, sourceKey, config) {
  return {
    project: { key: config.hwProject },
    issuetype: { name: config.hwIssueType },
    summary: sourceIssue?.fields?.summary || `Hardware request for ${sourceKey}`,
    ...(sourceIssue?.fields?.description !== undefined && sourceIssue?.fields?.description !== null
      ? { description: sourceIssue.fields.description }
      : {}),
    ...buildMappedHardwareFields(sourceIssue, config),
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
