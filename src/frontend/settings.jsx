import React, { useEffect, useState } from "react";
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Label,
  MessageBanner,
  Select,
  Stack,
  Text,
  Textfield,
  Toggle,
  xcss,
} from "@forge/react";
import { invoke } from "@forge/bridge";

const sectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "elevation.surface" });

function fieldOption(fields, value) {
  return fields.find((item) => item.value === value) || (value ? { label: value, value } : null);
}

function App() {
  const [config, setConfig] = useState(null);
  const [projects, setProjects] = useState([]);
  const [fields, setFields] = useState([]);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    Promise.all([invoke("getConfig"), invoke("getOptions")])
      .then(([saved, options]) => {
        setConfig(saved);
        setProjects(options.projects || []);
        setFields(options.fields || []);
      })
      .catch((error) => {
        setLoadError(`Could not load Delivery Manager settings: ${String(error)}`);
      });
  }, []);

  if (loadError) {
    return (
      <Stack space="space.200">
        <Heading as="h1">Delivery Manager settings</Heading>
        <MessageBanner appearance="error">{loadError}</MessageBanner>
        <Text>Refresh the page after the app has been upgraded. If this remains, the error above can be used to diagnose the backend call.</Text>
      </Stack>
    );
  }

  if (!config) return <Text>Loading Delivery Manager settings…</Text>;

  const patch = (key, value) => setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      const result = await invoke("saveConfig", { config });
      setConfig(result.config);
      setMessage({ appearance: "success", text: "Settings saved." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not save settings: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    setValidation(null);
    try {
      const result = await invoke("validateConfig", { config });
      setValidation(result);
      setMessage({
        appearance: result.ok ? "success" : "warning",
        text: result.ok ? "Configuration is valid and ready for sandbox testing." : "Configuration needs attention before testing.",
      });
    } catch (error) {
      setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const projectSelect = (key) => (
    <Select options={projects} value={projects.find((p) => p.value === config[key]) || { label: config[key], value: config[key] }} onChange={(option) => patch(key, option?.value || "")} />
  );

  const fieldSelect = (key) => (
    <Select options={fields} value={fieldOption(fields, config[key])} onChange={(option) => patch(key, option?.value || "")} />
  );

  return (
    <Stack space="space.300">
      <Box>
        <Heading as="h1">Delivery Manager settings</Heading>
        <Text>Configure DHL tracking and the SD ↔ Hardware workflow. Validate everything before enabling automation.</Text>
      </Box>

      {message && <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner>}

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Projects & workflow</Heading>
          <Label labelFor="sd-project">Service project</Label>{projectSelect("sdProject")}
          <Label labelFor="hw-project">Hardware project</Label>{projectSelect("hwProject")}
          <Label labelFor="sd-sent">SD status that triggers hardware handover</Label>
          <Textfield id="sd-sent" value={config.sdSentStatus} onChange={(e) => patch("sdSentStatus", e.target.value)} />
          <Label labelFor="hw-dispatched">HW dispatched status</Label>
          <Textfield id="hw-dispatched" value={config.hwDispatchedStatus} onChange={(e) => patch("hwDispatchedStatus", e.target.value)} />
          <Label labelFor="sd-dispatched">SD dispatched status</Label>
          <Textfield id="sd-dispatched" value={config.sdDispatchedStatus} onChange={(e) => patch("sdDispatchedStatus", e.target.value)} />
          <Label labelFor="resolved">SD final resolved status</Label>
          <Textfield id="resolved" value={config.resolvedStatus} onChange={(e) => patch("resolvedStatus", e.target.value)} />
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Jira fields</Heading>
          <Text>These are the fields Delivery Manager will use for DHL and hardware dispatch data.</Text>
          <Label>Tracking Number</Label>{fieldSelect("trackingField")}
          <Label>Date Sent</Label>{fieldSelect("dateSentField")}
          <Label>Delivery Status</Label>{fieldSelect("deliveryStatusField")}
          <Label>Date Delivered</Label>{fieldSelect("deliveryDateField")}
          <Label>Signed For</Label>{fieldSelect("signedForField")}
          <Label>Last DHL Check</Label>{fieldSelect("lastDhlCheckField")}
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Hardware handover</Heading>
          <Label labelFor="hw-type">HW issue type</Label>
          <Textfield id="hw-type" value={config.hwIssueType} onChange={(e) => patch("hwIssueType", e.target.value)} placeholder="Leave blank while auto-creation is off" />
          <Label labelFor="link-type">Issue link type</Label>
          <Textfield id="link-type" value={config.hwLinkType} onChange={(e) => patch("hwLinkType", e.target.value)} />
          <Toggle isChecked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} label="Add internal reconciliation comments" />
          <Toggle isChecked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} label="Allow workflow transitions" />
          <Toggle isChecked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} label="Automatically create missing HW tickets" />
          {config.createEnabled && <MessageBanner appearance="warning">Only enable HW ticket creation after validation and reconciliation-only testing have passed.</MessageBanner>}
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Validation</Heading>
          <Text>Validation checks that projects, fields and statuses exist and are accessible to the app.</Text>
          <Box><Button appearance="primary" onClick={validate} isDisabled={busy}>Validate configuration</Button> <Button onClick={save} isDisabled={busy}>Save settings</Button></Box>
          {validation && validation.checks.map((check) => (
            <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.key}: {check.message}</Text>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
