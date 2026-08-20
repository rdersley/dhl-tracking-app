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

const FIELD_LABELS = {
  tracking: "Tracking number field",
  deliveryStatus: "Delivery Status field",
  deliveryDate: "Date Delivered field",
  signedFor: "Signed For field",
  dateSent: "Date Sent field",
  lastDhlCheck: "Last DHL Check field",
  client: "Client field (optional)"
};

const STATUS_LABELS = {
  dispatched: "Initial dispatched status",
  outForDelivery: "Out for delivery status",
  awaitingCollection: "Awaiting collection status",
  onHold: "Delivery on hold status",
  failed: "Delivery failed status",
  resolved: "Resolved status"
};

const DELIVERY_LABELS = {
  delivered: "Delivered",
  returnedToSender: "Returned to Sender",
  deliveryFailed: "Delivery Attempted / Failed",
  awaitingCollection: "Awaiting Collection",
  onHold: "On Hold / Exception",
  customsDelay: "Customs Delay",
  outForDelivery: "Out for Delivery",
  inTransit: "In Transit",
  unknown: "Unknown"
};

const COMMENT_LABELS = {
  outForDelivery: "Out for delivery comment",
  awaitingCollection: "Awaiting collection comment",
  onHold: "On hold comment",
  failed: "Failed / returned comment",
  delivered: "Delivered comment"
};

function valueOption(value) {
  return value ? { label: value, value } : null;
}

function App() {
  const [config, setConfig] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [metadata, setMetadata] = useState({ fields: [], statuses: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [testTracking, setTestTracking] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([invoke("getSettings"), invoke("getJiraMetadata")])
      .then(([settings, jiraMetadata]) => {
        setConfig(settings.config);
        setHasApiKey(settings.hasApiKey);
        setMetadata(jiraMetadata);
      })
      .catch((error) => {
        setMessage({ appearance: "error", title: "Unable to load settings", body: String(error) });
      })
      .finally(() => setLoading(false));
  }, []);

  const fieldOptions = useMemo(
    () => metadata.fields.map((field) => ({ label: `${field.name} (${field.id})`, value: field.id })),
    [metadata.fields]
  );

  const statusOptions = useMemo(
    () => metadata.statuses.map((status) => ({ label: status.name, value: status.name })),
    [metadata.statuses]
  );

  if (loading || !config) return <Spinner size="large" />;

  const updateRoot = (key, value) => setConfig((old) => ({ ...old, [key]: value }));
  const updateNested = (section, key, value) => setConfig((old) => ({
    ...old,
    [section]: { ...old[section], [key]: value }
  }));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await invoke("saveSettings", { config, dhlApiKey: apiKey });
      setHasApiKey(result.hasApiKey);
      setApiKey("");
      setMessage({ appearance: "confirmation", title: "Settings saved", body: "The scheduler will use these settings on its next run." });
    } catch (error) {
      setMessage({ appearance: "error", title: "Could not save settings", body: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const testDhl = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await invoke("testDhlConnection", { trackingNumber: testTracking });
      setMessage({
        appearance: result.ok ? "confirmation" : "error",
        title: result.ok ? "DHL connection successful" : "DHL test failed",
        body: result.description || result.message || `HTTP ${result.status}`
      });
    } catch (error) {
      setMessage({ appearance: "error", title: "DHL test failed", body: String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Stack space="space.400">
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
          <Textfield id="projectKey" value={config.projectKey} onChange={(event) => updateRoot("projectKey", event.target.value)} />

          <Label labelFor="minDaysSinceSent">Minimum days since Date Sent</Label>
          <Textfield id="minDaysSinceSent" type="number" value={String(config.minDaysSinceSent)} onChange={(event) => updateRoot("minDaysSinceSent", Number(event.target.value))} />

          <Label labelFor="maxPerRun">Maximum tickets per run</Label>
          <Textfield id="maxPerRun" type="number" value={String(config.maxPerRun)} onChange={(event) => updateRoot("maxPerRun", Number(event.target.value))} />
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">DHL API</Heading>
        <Stack space="space.200">
          <SectionMessage appearance="information">API endpoint: {config.dhlBaseUrl}</SectionMessage>
          <Label labelFor="dhlApiKey">DHL API key {hasApiKey ? "(already saved)" : "(required)"}</Label>
          <Textfield id="dhlApiKey" type="password" value={apiKey} placeholder={hasApiKey ? "Leave blank to keep the existing key" : "Enter DHL API key"} onChange={(event) => setApiKey(event.target.value)} />

          <Label labelFor="testTracking">Test tracking number</Label>
          <Textfield id="testTracking" value={testTracking} onChange={(event) => setTestTracking(event.target.value)} />
          <Button appearance="default" onClick={testDhl} isLoading={testing}>Test DHL connection</Button>
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Jira field mapping</Heading>
        <Stack space="space.200">
          {Object.entries(FIELD_LABELS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`field-${key}`}>{label}</Label>
              <Select
                inputId={`field-${key}`}
                options={fieldOptions}
                value={valueOption(config.fields[key])}
                onChange={(option) => updateNested("fields", key, option?.value || "")}
              />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Workflow status mapping</Heading>
        <Stack space="space.200">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`status-${key}`}>{label}</Label>
              <Select
                inputId={`status-${key}`}
                options={statusOptions}
                value={valueOption(config.workflowStatuses[key])}
                onChange={(option) => updateNested("workflowStatuses", key, option?.value || "")}
              />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Delivery Status field values</Heading>
        <Stack space="space.200">
          <SectionMessage appearance="information">These values must exactly match options in the selected Jira Delivery Status field.</SectionMessage>
          {Object.entries(DELIVERY_LABELS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`delivery-${key}`}>{label}</Label>
              <Textfield id={`delivery-${key}`} value={config.deliveryStatusValues[key] || ""} onChange={(event) => updateNested("deliveryStatusValues", key, event.target.value)} />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Heading as="h2">Internal comment templates</Heading>
        <Stack space="space.200">
          <Checkbox
            label="Add internal comments when Jira workflow status changes"
            isChecked={Boolean(config.comments.enabled)}
            onChange={() => updateNested("comments", "enabled", !config.comments.enabled)}
          />
          <SectionMessage appearance="information">Available placeholders: {"{issueKey}"}, {"{trackingNumber}"}, {"{deliveryStatus}"}, {"{dhlDescription}"}, {"{date}"}, {"{signedFor}"}.</SectionMessage>
          {Object.entries(COMMENT_LABELS).map(([key, label]) => (
            <Box key={key}>
              <Label labelFor={`comment-${key}`}>{label}</Label>
              <TextArea id={`comment-${key}`} value={config.comments[key] || ""} onChange={(event) => updateNested("comments", key, event.target.value)} />
            </Box>
          ))}
        </Stack>
      </Box>

      <Button appearance="primary" onClick={save} isLoading={saving}>Save settings</Button>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
