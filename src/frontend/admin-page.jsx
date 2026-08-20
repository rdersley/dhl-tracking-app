import React, { useEffect, useMemo, useState } from "react";
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  Heading,
  Label,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  TextArea,
  Textfield,
  Toggle
} from "@forge/react";
import { invoke } from "@forge/bridge";

const CORE_FIELDS = {
  tracking: "Tracking number field",
  deliveryStatus: "Delivery Status field (optional)",
  deliveryDate: "Delivered date field (optional)",
  signedFor: "Signed for field (optional)",
  dateSent: "Date sent / dispatched field (optional)",
  lastDhlCheck: "Last DHL check field (optional)",
  client: "Client / airline field (optional)"
};

const ADVANCED_DHL_FIELDS = [
  { label: "Current DHL status", path: "status.description" },
  { label: "Current DHL status code", path: "status.statusCode" },
  { label: "Current status timestamp", path: "status.timestamp" },
  { label: "Estimated delivery", path: "estimatedTimeOfDelivery" },
  { label: "Estimated delivery from", path: "estimatedDeliveryTimeFrame.estimatedFrom" },
  { label: "Estimated delivery through", path: "estimatedDeliveryTimeFrame.estimatedThrough" },
  { label: "Latest event description", path: "events.0.description" },
  { label: "Latest event code", path: "events.0.statusCode" },
  { label: "Latest event timestamp", path: "events.0.timestamp" },
  { label: "Latest event location", path: "events.0.location.address.addressLocality" },
  { label: "Origin city", path: "origin.address.addressLocality" },
  { label: "Origin postcode", path: "origin.address.postalCode" },
  { label: "Origin country", path: "origin.address.countryCode" },
  { label: "Destination city", path: "destination.address.addressLocality" },
  { label: "Destination postcode", path: "destination.address.postalCode" },
  { label: "Destination country", path: "destination.address.countryCode" },
  { label: "DHL shipment / waybill ID", path: "id" },
  { label: "DHL service", path: "service" }
];

function option(value, label = value) {
  return value ? { label, value } : null;
}

function CollapsibleSection({ title, open, onToggle, children }) {
  return (
    <Box>
      <Button appearance="subtle" onClick={onToggle}>
        {open ? `▼ ${title}` : `▶ ${title}`}
      </Button>
      {open ? <Box>{children}</Box> : null}
    </Box>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [metadata, setMetadata] = useState({ fields: [], statuses: [] });
  const [deliveryOptions, setDeliveryOptions] = useState([]);
  const [previewFields, setPreviewFields] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [testTracking, setTestTracking] = useState("");
  const [openSections, setOpenSections] = useState({
    general: true,
    api: true,
    core: true,
    status: true,
    advanced: false,
    comments: false,
    log: false
  });

  const toggleSection = (key) => {
    setOpenSections((old) => ({ ...old, [key]: !old[key] }));
  };

  const reloadLog = async () => {
    try {
      setActivityLog((await invoke("getActivityLog")) || []);
    } catch {
      setActivityLog([]);
    }
  };

  useEffect(() => {
    Promise.all([
      invoke("getSettings"),
      invoke("getJiraMetadata"),
      invoke("getActivityLog")
    ])
      .then(([settings, jiraMetadata, log]) => {
        setConfig(settings.config);
        setHasApiKey(settings.hasApiKey);
        setMetadata(jiraMetadata);
        setActivityLog(log || []);
      })
      .catch((error) => {
        setMessage({ appearance: "error", title: "Unable to load settings", body: String(error) });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const fieldId = config?.fields?.deliveryStatus;
    if (!fieldId) {
      setDeliveryOptions([]);
      return;
    }
    invoke("getFieldOptions", { fieldId })
      .then((items) => setDeliveryOptions(items || []))
      .catch(() => setDeliveryOptions([]));
  }, [config?.fields?.deliveryStatus]);

  const fieldOptions = useMemo(
    () => metadata.fields.map((field) => ({
      label: `${field.name} (${field.id})`,
      value: field.id
    })),
    [metadata.fields]
  );

  const fieldName = (fieldId) => {
    if (!fieldId) return "";
    return metadata.fields.find((field) => field.id === fieldId)?.name || fieldId;
  };

  const selectedFieldOption = (fieldId) => {
    if (!fieldId) return null;
    return option(fieldId, fieldName(fieldId));
  };

  const statusOptions = useMemo(
    () => [
      { label: "— Do not transition —", value: "" },
      ...metadata.statuses.map((status) => ({ label: status.name, value: status.name }))
    ],
    [metadata.statuses]
  );

  const deliveryStatusOptions = useMemo(
    () => [
      { label: "— Do not update Delivery Status —", value: "" },
      ...deliveryOptions.map((item) => ({ label: item.value, value: item.value }))
    ],
    [deliveryOptions]
  );

  const advancedDhlOptions = useMemo(
    () => ADVANCED_DHL_FIELDS.map((item) => ({ label: item.label, value: item.path })),
    []
  );

  if (loading || !config) return <Spinner size="large" />;

  const updateRoot = (key, value) => setConfig((old) => ({ ...old, [key]: value }));
  const updateField = (key, value) => setConfig((old) => ({
    ...old,
    fields: { ...old.fields, [key]: value }
  }));

  const updateStatusMapping = (index, patch) => {
    setConfig((old) => {
      const rows = [...(old.statusMappings || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...old, statusMappings: rows };
    });
  };

  const updateAdditionalMapping = (index, patch) => {
    setConfig((old) => {
      const rows = [...(old.additionalFieldMappings || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...old, additionalFieldMappings: rows };
    });
  };

  const addAdvancedMapping = () => {
    setConfig((old) => ({
      ...old,
      additionalFieldMappings: [
        ...(old.additionalFieldMappings || []),
        { label: "", dhlPath: "", jiraFieldId: "" }
      ]
    }));
  };

  const removeAdvancedMapping = (index) => {
    setConfig((old) => ({
      ...old,
      additionalFieldMappings: (old.additionalFieldMappings || []).filter((_, i) => i !== index)
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await invoke("saveSettings", { config, dhlApiKey: apiKey });
      setHasApiKey(result.hasApiKey);
      setApiKey("");
      setMessage({
        appearance: "confirmation",
        title: "Settings saved",
        body: "The scheduler will use these settings on its next run."
      });
      await reloadLog();
    } catch (error) {
      setMessage({ appearance: "error", title: "Could not save settings", body: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const inspectTracking = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await invoke("inspectDhlTracking", { trackingNumber: testTracking });
      setPreviewFields(result.fields || []);
      setMessage({
        appearance: result.shipmentFound ? "confirmation" : "warning",
        title: result.shipmentFound ? "DHL connection successful" : "No shipment returned",
        body: result.description || "DHL API responded successfully."
      });
    } catch (error) {
      setMessage({ appearance: "error", title: "DHL test failed", body: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const clearLog = async () => {
    await invoke("clearActivityLog");
    setActivityLog([]);
  };

  return (
    <Stack space="space.500">
      <Heading as="h1">DHL Tracking for Jira — Settings</Heading>

      {message && (
        <SectionMessage appearance={message.appearance} title={message.title}>
          {message.body}
        </SectionMessage>
      )}

      <CollapsibleSection title="General" open={openSections.general} onToggle={() => toggleSection("general")}>
        <Stack space="space.200">
          <Toggle id="enabled" isChecked={Boolean(config.enabled)} onChange={() => updateRoot("enabled", !config.enabled)} />
          <Label labelFor="projectKey">Jira project key</Label>
          <Textfield id="projectKey" value={config.projectKey || ""} onChange={(e) => updateRoot("projectKey", e.target.value)} />
          <Label labelFor="minDaysSinceSent">Minimum days since Date Sent</Label>
          <Textfield id="minDaysSinceSent" type="number" value={String(config.minDaysSinceSent ?? 0)} onChange={(e) => updateRoot("minDaysSinceSent", Number(e.target.value))} />
          <Label labelFor="maxPerRun">Maximum tickets per run</Label>
          <Textfield id="maxPerRun" type="number" value={String(config.maxPerRun ?? 3)} onChange={(e) => updateRoot("maxPerRun", Number(e.target.value))} />
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="DHL API & connection test" open={openSections.api} onToggle={() => toggleSection("api")}>
        <Stack space="space.200">
          <SectionMessage appearance="information">
            The test only checks the DHL connection and previews a shipment. It does not create your status mappings.
          </SectionMessage>
          <Label labelFor="dhlApiKey">DHL API key {hasApiKey ? "(already saved)" : "(required)"}</Label>
          <Textfield id="dhlApiKey" type="password" value={apiKey} placeholder={hasApiKey ? "Leave blank to keep existing key" : "Enter DHL API key"} onChange={(e) => setApiKey(e.target.value)} />
          <Label labelFor="testTracking">Tracking number for connection test</Label>
          <Textfield id="testTracking" value={testTracking} onChange={(e) => setTestTracking(e.target.value)} />
          <Button onClick={inspectTracking} isLoading={testing}>Test DHL connection</Button>
          {previewFields.length > 0 ? (
            <Box>
              <Heading as="h3">Shipment preview</Heading>
              {previewFields.map((item) => (
                <SectionMessage key={item.path} appearance="information">
                  {item.path}: {item.value}
                </SectionMessage>
              ))}
            </Box>
          ) : null}
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="Core Jira field mapping" open={openSections.core} onToggle={() => toggleSection("core")}>
        <Stack space="space.200">
          <SectionMessage appearance="information">
            Choose the Jira fields used by this site. The selected field name is shown; the custom field ID is only shown in the dropdown for reference.
          </SectionMessage>
          {Object.entries(CORE_FIELDS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`field-${key}`}>{label}</Label>
              <Select
                inputId={`field-${key}`}
                options={fieldOptions}
                value={selectedFieldOption(config.fields?.[key])}
                onChange={(selected) => updateField(key, selected?.value || "")}
              />
            </Box>
          ))}
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="Standard DHL status → Jira mapping" open={openSections.status} onToggle={() => toggleSection("status")}>
        <Stack space="space.300">
          <SectionMessage appearance="information">
            These are standard DHL categories built into the app. They are not generated from the test shipment. Map each category once to the Jira workflow status and Delivery Status value you want.
          </SectionMessage>
          {(config.statusMappings || []).map((row, index) => (
            <Box key={row.category || index}>
              <Heading as="h3">{row.label || row.category}</Heading>
              <Checkbox label="Enabled" isChecked={row.enabled !== false} onChange={() => updateStatusMapping(index, { enabled: row.enabled === false })} />
              <Checkbox label="Terminal event — stop checking this ticket after it occurs" isChecked={Boolean(row.terminal)} onChange={() => updateStatusMapping(index, { terminal: !row.terminal })} />
              <Label labelFor={`jira-status-${index}`}>Jira workflow status</Label>
              <Select
                inputId={`jira-status-${index}`}
                options={statusOptions}
                value={option(row.jiraStatus || "", row.jiraStatus || "— Do not transition —")}
                onChange={(selected) => updateStatusMapping(index, { jiraStatus: selected?.value || "" })}
              />
              <Label labelFor={`delivery-status-${index}`}>Delivery Status field value</Label>
              <Select
                inputId={`delivery-status-${index}`}
                options={deliveryStatusOptions}
                value={option(row.deliveryStatus || "", row.deliveryStatus || "— Do not update Delivery Status —")}
                onChange={(selected) => updateStatusMapping(index, { deliveryStatus: selected?.value || "" })}
              />
              <Label labelFor={`comment-${index}`}>Internal comment template (optional)</Label>
              <TextArea
                id={`comment-${index}`}
                value={row.commentTemplate || ""}
                onChange={(e) => updateStatusMapping(index, { commentTemplate: e.target.value })}
              />
            </Box>
          ))}
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="Advanced DHL → Jira field mappings" open={openSections.advanced} onToggle={() => toggleSection("advanced")}>
        <Stack space="space.300">
          <SectionMessage appearance="information">
            Optional. Use this only if you want extra DHL values written into Jira. Most customers will not need this section.
          </SectionMessage>
          {(config.additionalFieldMappings || []).map((row, index) => (
            <Box key={`advanced-${index}`}>
              <Label labelFor={`advanced-label-${index}`}>Label</Label>
              <Textfield id={`advanced-label-${index}`} value={row.label || ""} onChange={(e) => updateAdditionalMapping(index, { label: e.target.value })} />
              <Label labelFor={`advanced-dhl-${index}`}>DHL information</Label>
              <Select
                inputId={`advanced-dhl-${index}`}
                options={advancedDhlOptions}
                value={option(row.dhlPath, ADVANCED_DHL_FIELDS.find((item) => item.path === row.dhlPath)?.label || row.dhlPath)}
                onChange={(selected) => {
                  const match = ADVANCED_DHL_FIELDS.find((item) => item.path === selected?.value);
                  updateAdditionalMapping(index, {
                    dhlPath: selected?.value || "",
                    label: row.label || match?.label || ""
                  });
                }}
              />
              <Label labelFor={`advanced-jira-${index}`}>Jira field</Label>
              <Select
                inputId={`advanced-jira-${index}`}
                options={fieldOptions}
                value={selectedFieldOption(row.jiraFieldId)}
                onChange={(selected) => updateAdditionalMapping(index, { jiraFieldId: selected?.value || "" })}
              />
              <Button appearance="danger" onClick={() => removeAdvancedMapping(index)}>Remove mapping</Button>
            </Box>
          ))}
          <Button onClick={addAdvancedMapping}>Add advanced field mapping</Button>
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="Activity log" open={openSections.log} onToggle={() => toggleSection("log")}>
        <Stack space="space.200">
          <SectionMessage appearance="information">
            Shows recent scheduler activity and configuration changes so administrators can confirm that DHL tracking is running.
          </SectionMessage>
          <Button onClick={reloadLog}>Refresh log</Button>
          <Button appearance="danger" onClick={clearLog}>Clear log</Button>
          {activityLog.length === 0 ? (
            <SectionMessage appearance="information">No activity has been recorded yet.</SectionMessage>
          ) : (
            activityLog.slice(0, 100).map((entry, index) => (
              <SectionMessage
                key={`${entry.timestamp || "log"}-${index}`}
                appearance={entry.level === "error" ? "error" : entry.level === "warning" ? "warning" : "information"}
              >
                {entry.timestamp || ""} — {entry.issueKey ? `${entry.issueKey} — ` : ""}{entry.action || "Activity"}{entry.details ? ` — ${entry.details}` : ""}
              </SectionMessage>
            ))
          )}
        </Stack>
      </CollapsibleSection>

      <Button appearance="primary" onClick={save} isLoading={saving}>Save settings</Button>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
