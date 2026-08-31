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

const UI_BUILD = "DM-SETTINGS-20260831-2";
const sectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "elevation.surface" });

const FALLBACK_CONFIG = {
  sdProject: "SD",
  hwProject: "HW",
  sdSentStatus: "Sent to Hardware",
  hwDispatchedStatus: "Dispatched",
  sdDispatchedStatus: "Dispatched",
  resolvedStatus: "Resolved",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  deliveryStatusField: "customfield_11952",
  deliveryDateField: "customfield_10434",
  signedForField: "customfield_10442",
  lastDhlCheckField: "customfield_14400",
  hwIssueType: "",
  hwLinkType: "Relates",
  commentsEnabled: true,
  transitionsEnabled: true,
  createEnabled: false,
};

function optionFor(options, value) {
  return options.find((item) => item.value === value) || (value ? { label: value, value } : null);
}

function withTimeout(promise, label, timeoutMs = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
  ]);
}

function App() {
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [projects, setProjects] = useState([]);
  const [fields, setFields] = useState([]);
  const [sdStatuses, setSdStatuses] = useState([]);
  const [hwStatuses, setHwStatuses] = useState([]);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [configStatus, setConfigStatus] = useState("Loading saved settings…");
  const [optionsStatus, setOptionsStatus] = useState("Loading Jira projects and fields…");
  const [statusStatus, setStatusStatus] = useState("Loading project statuses…");

  useEffect(() => {
    withTimeout(invoke("getConfig"), "Saved settings request")
      .then((saved) => {
        setConfig((current) => ({ ...current, ...(saved || {}) }));
        setConfigStatus("Saved settings loaded successfully.");
      })
      .catch((error) => {
        setConfigStatus(`Saved settings could not be loaded: ${String(error)}`);
      });

    withTimeout(invoke("getOptions"), "Jira options request")
      .then((options) => {
        setProjects(options?.projects || []);
        setFields(options?.fields || []);
        setOptionsStatus(`Jira options loaded: ${options?.projects?.length || 0} projects, ${options?.fields?.length || 0} fields.`);
      })
      .catch((error) => {
        setOptionsStatus(`Jira projects/fields could not be loaded: ${String(error)}`);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatusStatus("Loading project statuses…");

    Promise.all([
      withTimeout(invoke("getProjectStatuses", { projectKey: config.sdProject }), "Service project statuses"),
      withTimeout(invoke("getProjectStatuses", { projectKey: config.hwProject }), "Hardware project statuses"),
    ])
      .then(([sdResult, hwResult]) => {
        if (cancelled) return;
        setSdStatuses(sdResult?.statuses || []);
        setHwStatuses(hwResult?.statuses || []);
        const sdCount = sdResult?.statuses?.length || 0;
        const hwCount = hwResult?.statuses?.length || 0;
        setStatusStatus(`Project statuses loaded: ${sdCount} SD statuses, ${hwCount} HW statuses.`);
      })
      .catch((error) => {
        if (!cancelled) setStatusStatus(`Project statuses could not be loaded: ${String(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [config.sdProject, config.hwProject]);

  const patch = (key, value) => setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      const result = await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      setConfig((current) => ({ ...current, ...(result?.config || {}) }));
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
      const result = await withTimeout(invoke("validateConfig", { config }), "Validation request", 20000);
      setValidation(result);
      setMessage({
        appearance: result?.ok ? "success" : "warning",
        text: result?.ok ? "Configuration is valid and ready for sandbox testing." : "Configuration needs attention before testing.",
      });
    } catch (error) {
      setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const projectSelect = (key) => (
    <Select
      options={projects}
      value={optionFor(projects, config[key])}
      onChange={(option) => patch(key, option?.value || "")}
    />
  );

  const fieldSelect = (key) => (
    <Select
      options={fields}
      value={optionFor(fields, config[key])}
      onChange={(option) => patch(key, option?.value || "")}
    />
  );

  const statusSelect = (key, options) => (
    <Select
      options={options}
      value={optionFor(options, config[key])}
      onChange={(option) => patch(key, option?.value || "")}
    />
  );

  return (
    <Stack space="space.300">
      <Box>
        <Heading as="h1">Delivery Manager settings</Heading>
        <Text>Configure DHL tracking and the SD ↔ Hardware workflow. Validate everything before enabling automation.</Text>
        <Text>UI build: {UI_BUILD}</Text>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.100">
          <Heading as="h2">Connection status</Heading>
          <Text>{configStatus}</Text>
          <Text>{optionsStatus}</Text>
          <Text>{statusStatus}</Text>
        </Stack>
      </Box>

      {message && <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner>}

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Projects & workflow</Heading>
          <Label labelFor="sd-project">Service project</Label>{projectSelect("sdProject")}
          <Label labelFor="hw-project">Hardware project</Label>{projectSelect("hwProject")}
          <Label>SD status that triggers hardware handover</Label>{statusSelect("sdSentStatus", sdStatuses)}
          <Label>HW dispatched status</Label>{statusSelect("hwDispatchedStatus", hwStatuses)}
          <Label>SD dispatched status</Label>{statusSelect("sdDispatchedStatus", sdStatuses)}
          <Label>SD final resolved status</Label>{statusSelect("resolvedStatus", sdStatuses)}
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <Heading as="h2">Jira fields</Heading>
          <Text>The dropdowns show Jira field names; Delivery Manager stores the underlying field IDs safely.</Text>
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
          {validation?.checks?.map((check) => (
            <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.key}: {check.message}</Text>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
