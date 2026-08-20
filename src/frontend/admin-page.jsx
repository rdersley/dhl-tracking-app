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

  const reloadObserved = async () => {
    const statuses = await invoke("getObservedDhlStatuses");
    setObservedStatuses(statuses || []);
  };

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

  const dhlPathOptions = useMemo(
    () => dhlFields.map((item) => ({ label: `${item.path} = ${item.value}`, value: item.path })),
    [dhlFields]
  );

  if (loading || !config) return <Spinner size="large" />;

  const updateRoot = (key, value) => setConfig((old) => ({ ...old, [key]: value }));
  const updateField = (key, value) => setConfig((old) => ({
    ...old,
    fields: { ...old.fields, [key]: value }
  }));

  const updateAdditionalMapping = (index, patch) => {
    setConfig((old) => {
      const rows = [...(old.additionalFieldMappings || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...old, additionalFieldMappings: rows };
    });
  };

  const addAdditionalMapping = () => {
    setConfig((old) => ({
      ...old,
      additionalFieldMappings: [
        ...(old.additionalFieldMappings || []),
        { label: "", dhlPath: "", jiraFieldId: "" }
      ]
    }));
  };

  const removeAdditionalMapping = (index) => {
    setConfig((old) => ({
      ...old,
      additionalFieldMappings: (old.additionalFieldMappings || []).filter((_, i) => i !== index)
    }));
  };

  const updateStatusMapping = (index, patch) => {
    setConfig((old) => {
      const rows = [...(old.statusMappings || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...old, statusMappings: rows };
    });
  };

  const addStatusMapping = (status = null) => {
    setConfig((old) => ({
      ...old,
      statusMappings: [
        ...(old.statusMappings || []),
        {
          dhlText: status?.description || "",
          dhlCode: status?.code || "",
          matchType: "contains",
          jiraStatus: "",
          deliveryStatus: "",
          enabled: true,
          commentTemplate: ""
        }
      ]
    }));
  };

  const removeStatusMapping = (index) => {
    setConfig((old) => ({
      ...old,
      statusMappings: (old.statusMappings || []).filter((_, i) => i !== index)
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
        body: "The scheduler will use these mappings on its next run."
      });
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
      setDhlFields(result.fields || []);
      setObservedStatuses(result.statuses || []);
      setMessage({
        appearance: result.shipmentFound ? "confirmation" : "warning",
        title: result.shipmentFound ? "DHL shipment loaded" : "No shipment returned",
        body: result.description || "DHL connection successful."
      });
    } catch (error) {
      setMessage({ appearance: "error", title: "DHL inspection failed", body: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const mappedObservedKeys = new Set(
    (config.statusMappings || []).map((row) => `${String(row.dhlCode || "").trim()}|${String(row.dhlText || "").trim().toLowerCase()}`)
  );
  const unmappedObserved = observedStatuses.filter((status) => !mappedObservedKeys.has(status.key));

  return (
    <Stack space="space.500">
      <Heading as="h1">DHL Tracking for Jira — Settings</Heading>

      {message && (
        <SectionMessage appearance={message.appearance} title={message.title}>
          {message.body}
        </SectionMessage>
      )}

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
        <Heading as="h2">DHL API & data discovery</Heading>
        <Stack space="space.200">
          <SectionMessage appearance="information">
            Enter a real tracking number and inspect it. The app will show the DHL data fields and event descriptions returned by DHL so you can map them to Jira.
          </SectionMessage>
          <Label labelFor="dhlApiKey">DHL API key {hasApiKey ? "(already saved)" : "(required)"}</Label>
          <Textfield id="dhlApiKey" type="password" value={apiKey} placeholder={hasApiKey ? "Leave blank to keep existing key" : "Enter DHL API key"} onChange={(e) => setApiKey(e.target.value)} />
          <Label labelFor="testTracking">Tracking number for discovery/testing</Label>
          <Textfield id="testTracking" value={testTracking} onChange={(e) => setTestTracking(e.target.value)} />
          <Button onClick={inspectTracking} isLoading={testing}>Inspect DHL shipment</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Core Jira field mapping</Heading>
        <SectionMessage appearance="information">
          Only Tracking Number is required. All other fields are optional and can be different on every Jira site.
        </SectionMessage>
        <Stack space="space.200">
          {Object.entries(CORE_FIELDS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`field-${key}`}>{label}</Label>
              <Select
                inputId={`field-${key}`}
                options={fieldOptions}
                value={option(config.fields?.[key])}
                onChange={(selected) => updateField(key, selected?.value || "")}
              />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Additional DHL → Jira field mappings</Heading>
        <SectionMessage appearance="information">
          Map any additional value returned by DHL to any Jira field. Use Inspect DHL shipment first to populate the DHL data-path list.
        </SectionMessage>
        <Stack space="space.300">
          {(config.additionalFieldMappings || []).map((row, index) => (
            <Box key={`extra-${index}`}>
              <Label labelFor={`extra-label-${index}`}>Heading / label</Label>
              <Textfield id={`extra-label-${index}`} value={row.label || ""} onChange={(e) => updateAdditionalMapping(index, { label: e.target.value })} />
              <Label labelFor={`extra-dhl-${index}`}>DHL data</Label>
              <Select
                inputId={`extra-dhl-${index}`}
                options={dhlPathOptions}
                value={option(row.dhlPath)}
                onChange={(selected) => updateAdditionalMapping(index, { dhlPath: selected?.value || "" })}
              />
              <Label labelFor={`extra-jira-${index}`}>Jira field</Label>
              <Select
                inputId={`extra-jira-${index}`}
                options={fieldOptions}
                value={option(row.jiraFieldId)}
                onChange={(selected) => updateAdditionalMapping(index, { jiraFieldId: selected?.value || "" })}
              />
              <Button appearance="danger" onClick={() => removeAdditionalMapping(index)}>Remove mapping</Button>
            </Box>
          ))}
          <Button onClick={addAdditionalMapping}>Add field mapping</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">DHL event → Jira status mapping</Heading>
        <SectionMessage appearance="information">
          Every DHL event can have its own Jira workflow status, Delivery Status field value, and internal comment. Leave a Jira status blank if that DHL event should not move the ticket.
        </SectionMessage>
        <Stack space="space.300">
          {(config.statusMappings || []).map((row, index) => (
            <Box key={`status-map-${index}`}>
              <Label labelFor={`dhl-text-${index}`}>DHL event / status text</Label>
              <Textfield id={`dhl-text-${index}`} value={row.dhlText || ""} onChange={(e) => updateStatusMapping(index, { dhlText: e.target.value })} />
              <Label labelFor={`dhl-code-${index}`}>DHL code (optional)</Label>
              <Textfield id={`dhl-code-${index}`} value={row.dhlCode || ""} onChange={(e) => updateStatusMapping(index, { dhlCode: e.target.value })} />
              <Checkbox label="Enabled" isChecked={row.enabled !== false} onChange={() => updateStatusMapping(index, { enabled: row.enabled === false })} />
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
              <Button appearance="danger" onClick={() => removeStatusMapping(index)}>Remove status mapping</Button>
            </Box>
          ))}
          <Button onClick={() => addStatusMapping()}>Add status mapping manually</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Unmapped DHL events</Heading>
        {unmappedObserved.length === 0 ? (
          <SectionMessage appearance="information">No unmapped DHL events have been discovered yet. Inspect a shipment or let the scheduler run.</SectionMessage>
        ) : (
          <Stack space="space.200">
            {unmappedObserved.map((status) => (
              <Box key={status.key}>
                <Heading as="h3">{status.description}</Heading>
                <SectionMessage appearance="warning">
                  DHL code: {status.code || "—"} | DHL status: {status.status || "—"}
                </SectionMessage>
                <Button onClick={() => addStatusMapping(status)}>Map this DHL event</Button>
              </Box>
            ))}
          </Stack>
        )}
        <Button onClick={reloadObserved}>Refresh discovered events</Button>
      </Box>

      <Box>
        <Heading as="h2">Comments</Heading>
        <Checkbox
          label="Allow internal comments from DHL status mappings"
          isChecked={Boolean(config.comments?.enabled)}
          onChange={() => setConfig((old) => ({ ...old, comments: { ...old.comments, enabled: !old.comments?.enabled } }))}
        />
        <SectionMessage appearance="information">
          Comment placeholders: {"{issueKey}"}, {"{trackingNumber}"}, {"{dhlDescription}"}, {"{dhlCode}"}, {"{deliveryStatus}"}, {"{date}"}, {"{signedFor}"}.
        </SectionMessage>
      </Box>

      <Button appearance="primary" onClick={save} isLoading={saving}>Save settings</Button>
    </Stack>
  );
}

ForgeReconciler.render(<App />);
