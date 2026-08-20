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

function option(value, label = value) {
  return value ? { label, value } : null;
}

function looksTerminal(text) {
  const value = String(text || "").toLowerCase();
  return value.includes("delivered") || value.includes("returned") || value.includes("return to sender") || value.includes("delivery failed");
}

function friendlyLabel(path) {
  return String(path || "")
    .replace(/^events\.\d+\./, "Event ")
    .replace(/\./g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function chooseUsefulFields(fields) {
  const preferred = [
    /status\.description$/i,
    /status\.status$/i,
    /estimated.*delivery/i,
    /delivery.*time/i,
    /service/i,
    /product/i,
    /proof.*delivery/i,
    /recipient/i,
    /receiver/i,
    /destination/i,
    /origin/i,
    /weight/i,
    /pieces?/i,
    /events\.0\.timestamp$/i,
    /events\.0\.description$/i,
    /events\.0\.(statusCode|code)$/i
  ];

  const chosen = [];
  for (const pattern of preferred) {
    const item = fields.find((field) => pattern.test(field.path) && !chosen.some((x) => x.path === field.path));
    if (item) chosen.push(item);
  }
  return chosen.slice(0, 16);
}

function App() {
  const [config, setConfig] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [metadata, setMetadata] = useState({ fields: [], statuses: [] });
  const [deliveryOptions, setDeliveryOptions] = useState([]);
  const [observedStatuses, setObservedStatuses] = useState([]);
  const [dhlFields, setDhlFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [testTracking, setTestTracking] = useState("");

  useEffect(() => {
    Promise.all([
      invoke("getSettings"),
      invoke("getJiraMetadata"),
      invoke("getObservedDhlStatuses")
    ])
      .then(([settings, jiraMetadata, statuses]) => {
        setConfig(settings.config);
        setHasApiKey(settings.hasApiKey);
        setMetadata(jiraMetadata);
        setObservedStatuses(statuses || []);
      })
      .catch((error) => setMessage({ appearance: "error", title: "Unable to load settings", body: String(error) }))
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

  const fieldOptions = useMemo(() => metadata.fields.map((field) => ({
    label: `${field.name} (${field.id})`,
    value: field.id
  })), [metadata.fields]);

  const statusOptions = useMemo(() => [
    { label: "— Do not transition —", value: "" },
    ...metadata.statuses.map((status) => ({ label: status.name, value: status.name }))
  ], [metadata.statuses]);

  const deliveryStatusOptions = useMemo(() => [
    { label: "— Do not update Delivery Status —", value: "" },
    ...deliveryOptions.map((item) => ({ label: item.value, value: item.value }))
  ], [deliveryOptions]);

  const dhlPathOptions = useMemo(() => dhlFields.map((item) => ({
    label: `${item.path} = ${item.value}`,
    value: item.path
  })), [dhlFields]);

  if (loading || !config) return <Spinner size="large" />;

  const updateRoot = (key, value) => setConfig((old) => ({ ...old, [key]: value }));
  const updateField = (key, value) => setConfig((old) => ({ ...old, fields: { ...old.fields, [key]: value } }));

  const updateAdditionalMapping = (index, patch) => setConfig((old) => {
    const rows = [...(old.additionalFieldMappings || [])];
    rows[index] = { ...rows[index], ...patch };
    return { ...old, additionalFieldMappings: rows };
  });

  const removeAdditionalMapping = (index) => setConfig((old) => ({
    ...old,
    additionalFieldMappings: (old.additionalFieldMappings || []).filter((_, i) => i !== index)
  }));

  const updateStatusMapping = (index, patch) => setConfig((old) => {
    const rows = [...(old.statusMappings || [])];
    rows[index] = { ...rows[index], ...patch };
    return { ...old, statusMappings: rows };
  });

  const removeStatusMapping = (index) => setConfig((old) => ({
    ...old,
    statusMappings: (old.statusMappings || []).filter((_, i) => i !== index)
  }));

  const addAdditionalMapping = () => setConfig((old) => ({
    ...old,
    additionalFieldMappings: [...(old.additionalFieldMappings || []), { label: "", dhlPath: "", jiraFieldId: "" }]
  }));

  const addStatusMapping = (status = null) => setConfig((old) => ({
    ...old,
    statusMappings: [
      ...(old.statusMappings || []),
      {
        dhlText: status?.description || "",
        dhlCode: status?.code || "",
        jiraStatus: "",
        deliveryStatus: "",
        enabled: true,
        terminal: looksTerminal(status?.description),
        commentTemplate: ""
      }
    ]
  }));

  const autoPopulateFromInspection = (fields, statuses) => {
    setConfig((old) => {
      const existingPaths = new Set((old.additionalFieldMappings || []).map((row) => row.dhlPath));
      const useful = chooseUsefulFields(fields || []);
      const addedFields = useful
        .filter((item) => !existingPaths.has(item.path))
        .map((item) => ({
          label: friendlyLabel(item.path),
          dhlPath: item.path,
          jiraFieldId: ""
        }));

      const existingStatusKeys = new Set((old.statusMappings || []).map((row) =>
        `${String(row.dhlCode || "").trim()}|${String(row.dhlText || "").trim().toLowerCase()}`
      ));

      const addedStatuses = (statuses || [])
        .filter((status) => !existingStatusKeys.has(status.key))
        .map((status) => ({
          dhlText: status.description || "",
          dhlCode: status.code || "",
          jiraStatus: "",
          deliveryStatus: "",
          enabled: true,
          terminal: looksTerminal(status.description),
          commentTemplate: ""
        }));

      return {
        ...old,
        additionalFieldMappings: [...(old.additionalFieldMappings || []), ...addedFields],
        statusMappings: [...(old.statusMappings || []), ...addedStatuses]
      };
    });
  };

  const inspectTracking = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await invoke("inspectDhlTracking", { trackingNumber: testTracking });
      const fields = result.fields || [];
      const statuses = result.statuses || [];
      setDhlFields(fields);
      setObservedStatuses(statuses);
      if (result.shipmentFound) autoPopulateFromInspection(fields, statuses);
      setMessage({
        appearance: result.shipmentFound ? "confirmation" : "warning",
        title: result.shipmentFound ? "DHL shipment loaded and mappings populated" : "No shipment returned",
        body: result.shipmentFound
          ? `Discovered ${fields.length} DHL data values and ${statuses.length} DHL event/status values. Review the generated mapping rows below and choose the Jira targets you want.`
          : (result.description || "DHL connection successful.")
      });
    } catch (error) {
      setMessage({ appearance: "error", title: "DHL inspection failed", body: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await invoke("saveSettings", { config, dhlApiKey: apiKey });
      setHasApiKey(result.hasApiKey);
      setApiKey("");
      setMessage({ appearance: "confirmation", title: "Settings saved", body: "The scheduler will use these mappings on its next run." });
    } catch (error) {
      setMessage({ appearance: "error", title: "Could not save settings", body: String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack space="space.500">
      <Heading as="h1">DHL Tracking for Jira — Settings</Heading>

      {message && <SectionMessage appearance={message.appearance} title={message.title}>{message.body}</SectionMessage>}

      <Box>
        <Heading as="h2">General</Heading>
        <Stack space="space.200">
          <Toggle id="enabled" isChecked={Boolean(config.enabled)} onChange={() => updateRoot("enabled", !config.enabled)} />
          <Label labelFor="projectKey">Jira project key</Label>
          <Textfield id="projectKey" value={config.projectKey || ""} onChange={(e) => updateRoot("projectKey", e.target.value)} />
          <Label labelFor="minDaysSinceSent">Minimum days since Date Sent</Label>
          <Textfield id="minDaysSinceSent" type="number" value={String(config.minDaysSinceSent ?? 0)} onChange={(e) => updateRoot("minDaysSinceSent", Number(e.target.value))} />
          <Label labelFor="maxPerRun">Maximum tickets per run</Label>
          <Textfield id="maxPerRun" type="number" value={String(config.maxPerRun ?? 3)} onChange={(e) => updateRoot("maxPerRun", Number(e.target.value))} />
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">DHL API & automatic discovery</Heading>
        <SectionMessage appearance="information">
          Enter a real DHL tracking number and click Inspect DHL shipment. The app will automatically create mapping rows for the DHL fields and every event/status returned by DHL.
        </SectionMessage>
        <Stack space="space.200">
          <Label labelFor="dhlApiKey">DHL API key {hasApiKey ? "(already saved)" : "(required)"}</Label>
          <Textfield id="dhlApiKey" type="password" value={apiKey} placeholder={hasApiKey ? "Leave blank to keep existing key" : "Enter DHL API key"} onChange={(e) => setApiKey(e.target.value)} />
          <Label labelFor="testTracking">Tracking number for discovery/testing</Label>
          <Textfield id="testTracking" value={testTracking} onChange={(e) => setTestTracking(e.target.value)} />
          <Button appearance="primary" onClick={inspectTracking} isLoading={testing}>Inspect DHL shipment & populate mappings</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Core Jira field mapping</Heading>
        <SectionMessage appearance="information">Only Tracking Number is required. Select the Jira fields used by this site.</SectionMessage>
        <Stack space="space.200">
          {Object.entries(CORE_FIELDS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`field-${key}`}>{label}</Label>
              <Select inputId={`field-${key}`} options={fieldOptions} value={option(config.fields?.[key])} onChange={(selected) => updateField(key, selected?.value || "")} />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Additional DHL → Jira field mappings</Heading>
        <SectionMessage appearance="information">
          These rows are populated automatically from the inspected DHL shipment. Choose the Jira destination field for any DHL values you want copied back to the ticket. Leave Jira field blank to ignore that DHL value.
        </SectionMessage>
        <Stack space="space.300">
          {(config.additionalFieldMappings || []).length === 0 && <SectionMessage appearance="warning">No DHL fields discovered yet. Inspect a shipment above.</SectionMessage>}
          {(config.additionalFieldMappings || []).map((row, index) => (
            <Box key={`extra-${index}`}>
              <Label labelFor={`extra-label-${index}`}>Heading / label</Label>
              <Textfield id={`extra-label-${index}`} value={row.label || ""} onChange={(e) => updateAdditionalMapping(index, { label: e.target.value })} />
              <Label labelFor={`extra-dhl-${index}`}>DHL data</Label>
              <Select inputId={`extra-dhl-${index}`} options={dhlPathOptions} value={option(row.dhlPath)} onChange={(selected) => updateAdditionalMapping(index, { dhlPath: selected?.value || "" })} />
              <Label labelFor={`extra-jira-${index}`}>Jira field</Label>
              <Select inputId={`extra-jira-${index}`} options={fieldOptions} value={option(row.jiraFieldId)} onChange={(selected) => updateAdditionalMapping(index, { jiraFieldId: selected?.value || "" })} />
              <Button appearance="danger" onClick={() => removeAdditionalMapping(index)}>Remove mapping</Button>
            </Box>
          ))}
          <Button onClick={addAdditionalMapping}>Add another field mapping</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">DHL event → Jira status mapping</Heading>
        <SectionMessage appearance="information">
          Every DHL event returned by the inspected shipment is added automatically. For each event, choose the Jira workflow status, Delivery Status field option, comment, and whether it should stop future tracking.
        </SectionMessage>
        <Stack space="space.300">
          {(config.statusMappings || []).length === 0 && <SectionMessage appearance="warning">No DHL events discovered yet. Inspect a shipment above.</SectionMessage>}
          {(config.statusMappings || []).map((row, index) => (
            <Box key={`status-map-${index}`}>
              <Label labelFor={`dhl-text-${index}`}>DHL event / status text</Label>
              <Textfield id={`dhl-text-${index}`} value={row.dhlText || ""} onChange={(e) => updateStatusMapping(index, { dhlText: e.target.value })} />
              <Label labelFor={`dhl-code-${index}`}>DHL code</Label>
              <Textfield id={`dhl-code-${index}`} value={row.dhlCode || ""} onChange={(e) => updateStatusMapping(index, { dhlCode: e.target.value })} />
              <Checkbox label="Enabled" isChecked={row.enabled !== false} onChange={() => updateStatusMapping(index, { enabled: row.enabled === false })} />
              <Checkbox label="Terminal event — stop checking this ticket after it occurs" isChecked={Boolean(row.terminal)} onChange={() => updateStatusMapping(index, { terminal: !row.terminal })} />
              <Label labelFor={`jira-status-${index}`}>Jira workflow status</Label>
              <Select inputId={`jira-status-${index}`} options={statusOptions} value={option(row.jiraStatus || "", row.jiraStatus || "— Do not transition —")} onChange={(selected) => updateStatusMapping(index, { jiraStatus: selected?.value || "" })} />
              <Label labelFor={`delivery-status-${index}`}>Delivery Status field value</Label>
              <Select inputId={`delivery-status-${index}`} options={deliveryStatusOptions} value={option(row.deliveryStatus || "", row.deliveryStatus || "— Do not update Delivery Status —")} onChange={(selected) => updateStatusMapping(index, { deliveryStatus: selected?.value || "" })} />
              <Label labelFor={`comment-${index}`}>Internal comment template (optional)</Label>
              <TextArea id={`comment-${index}`} value={row.commentTemplate || ""} onChange={(e) => updateStatusMapping(index, { commentTemplate: e.target.value })} />
              <Button appearance="danger" onClick={() => removeStatusMapping(index)}>Remove status mapping</Button>
            </Box>
          ))}
          <Button onClick={() => addStatusMapping()}>Add status mapping manually</Button>
        </Stack>
      </Box>

      <Button appearance="primary" onClick={save} isLoading={saving}>Save settings</Button>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
