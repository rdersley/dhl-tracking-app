import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Heading, Label, MessageBanner, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import { invoke } from "@forge/bridge";

const UI_BUILD = "DM-COMBINED-RC-20260901-1";
const sectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "elevation.surface" });

const FALLBACK_CONFIG = {
  sdProject: "SD", hwProject: "HW", sdSentStatus: "Sent to Hardware", hwDispatchedStatus: "Dispatched", sdDispatchedStatus: "Dispatched",
  outForDeliveryStatus: "OUT FOR DELIVERY", awaitingCollectionStatus: "DELIVERY AWAITING COLLECTION", onHoldStatus: "DELIVERY ON HOLD", failedStatus: "DELIVERY FAILED", resolvedStatus: "Resolved",
  trackingField: "customfield_10417", dateSentField: "customfield_10433", deliveryStatusField: "customfield_11952", deliveryDateField: "customfield_10434", signedForField: "customfield_10442", lastDhlCheckField: "customfield_14400",
  clientField: "", clientRestrictionEnabled: false, clientValues: [], hwIssueType: "", hwLinkType: "Relates", commentsEnabled: true, transitionsEnabled: true, createEnabled: false,
  maxResults: 100, dhlBatchSize: 10, dhlDelayMs: 3000, minDaysSinceSent: 3,
};

const optionFor = (options, value) => options.find((item) => item.value === value) || (value ? { label: value, value } : null);
const withTimeout = (promise, label, timeoutMs = 12000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs))]);

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
    withTimeout(invoke("getConfig"), "Saved settings request").then((saved) => {
      setConfig((current) => ({ ...current, ...(saved || {}) }));
      setConfigStatus("Saved settings loaded successfully.");
    }).catch((error) => setConfigStatus(`Saved settings could not be loaded: ${String(error)}`));

    withTimeout(invoke("getOptions"), "Jira options request").then((options) => {
      setProjects(options?.projects || []);
      setFields(options?.fields || []);
      setOptionsStatus(`Jira options loaded: ${options?.projects?.length || 0} projects, ${options?.fields?.length || 0} fields.`);
    }).catch((error) => setOptionsStatus(`Jira projects/fields could not be loaded: ${String(error)}`));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatusStatus("Loading project statuses…");
    Promise.all([
      withTimeout(invoke("getProjectStatuses", { projectKey: config.sdProject }), "Service project statuses"),
      withTimeout(invoke("getProjectStatuses", { projectKey: config.hwProject }), "Hardware project statuses"),
    ]).then(([sdResult, hwResult]) => {
      if (cancelled) return;
      setSdStatuses(sdResult?.statuses || []);
      setHwStatuses(hwResult?.statuses || []);
      const problems = [sdResult?.ok ? null : `SD: ${sdResult?.error || "could not load"}`, hwResult?.ok ? null : `HW: ${hwResult?.error || "could not load"}`].filter(Boolean);
      setStatusStatus(problems.length ? `Status loading issue — ${problems.join(" | ")}` : `Project statuses loaded: ${sdResult?.statuses?.length || 0} SD statuses, ${hwResult?.statuses?.length || 0} HW statuses.`);
    }).catch((error) => { if (!cancelled) setStatusStatus(`Project statuses could not be loaded: ${String(error)}`); });
    return () => { cancelled = true; };
  }, [config.sdProject, config.hwProject]);

  const patch = (key, value) => setConfig((current) => ({ ...current, [key]: value }));
  const projectSelect = (key) => <Select options={projects} value={optionFor(projects, config[key])} onChange={(option) => patch(key, option?.value || "")} />;
  const fieldSelect = (key) => <Select options={fields} value={optionFor(fields, config[key])} onChange={(option) => patch(key, option?.value || "")} />;
  const statusSelect = (key, options, emptyText) => <Select options={options} value={optionFor(options, config[key])} onChange={(option) => patch(key, option?.value || "")} placeholder={options.length ? "Select a Jira status" : emptyText} />;

  const save = async () => {
    setBusy(true);
    try {
      const result = await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      setConfig((current) => ({ ...current, ...(result?.config || {}) }));
      setMessage({ appearance: "success", text: "Settings saved." });
    } catch (error) { setMessage({ appearance: "error", text: `Could not save settings: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    setBusy(true); setValidation(null);
    try {
      const result = await withTimeout(invoke("validateConfig", { config }), "Validation request", 30000);
      setValidation(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.ok ? "Configuration is valid for controlled testing." : "Configuration needs attention before testing." });
    } catch (error) { setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  return <Stack space="space.300">
    <Box><Heading as="h1">Delivery Manager settings</Heading><Text>One configuration centre for hardware handover, dispatch, DHL tracking and delivery resolution.</Text><Text>UI build: {UI_BUILD}</Text></Box>
    <Box xcss={sectionStyle}><Stack space="space.100"><Heading as="h2">Connection status</Heading><Text>{configStatus}</Text><Text>{optionsStatus}</Text><Text>{statusStatus}</Text></Stack></Box>
    {message && <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner>}

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">Projects & hardware workflow</Heading>
      <Label>Service project</Label>{projectSelect("sdProject")}<Label>Hardware project</Label>{projectSelect("hwProject")}
      <Label>SD status that triggers hardware handover</Label>{statusSelect("sdSentStatus", sdStatuses, "No SD statuses loaded")}
      <Label>HW dispatched status</Label>{statusSelect("hwDispatchedStatus", hwStatuses, "No HW statuses loaded")}
      <Label>SD dispatched status</Label>{statusSelect("sdDispatchedStatus", sdStatuses, "No SD statuses loaded")}
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">DHL delivery workflow</Heading>
      <Text>These Jira statuses are used as DHL moves a dispatched ticket through its delivery lifecycle.</Text>
      <Label>Out for Delivery status</Label>{statusSelect("outForDeliveryStatus", sdStatuses, "No SD statuses loaded")}
      <Label>Awaiting Collection status</Label>{statusSelect("awaitingCollectionStatus", sdStatuses, "No SD statuses loaded")}
      <Label>On Hold status</Label>{statusSelect("onHoldStatus", sdStatuses, "No SD statuses loaded")}
      <Label>Delivery Failed status</Label>{statusSelect("failedStatus", sdStatuses, "No SD statuses loaded")}
      <Label>Final Resolved status</Label>{statusSelect("resolvedStatus", sdStatuses, "No SD statuses loaded")}
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">Jira fields</Heading><Text>Field names are shown here; stable Jira field IDs are stored underneath.</Text>
      <Label>Tracking Number</Label>{fieldSelect("trackingField")}<Label>Date Sent</Label>{fieldSelect("dateSentField")}<Label>Delivery Status</Label>{fieldSelect("deliveryStatusField")}
      <Label>Date Delivered</Label>{fieldSelect("deliveryDateField")}<Label>Signed For</Label>{fieldSelect("signedForField")}<Label>Last DHL Check</Label>{fieldSelect("lastDhlCheckField")}
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">Client restrictions</Heading>
      <Toggle isChecked={config.clientRestrictionEnabled} onChange={(e) => patch("clientRestrictionEnabled", e.target.checked)} label="Restrict tracking to selected client values" />
      {config.clientRestrictionEnabled && <><Label>Client field</Label>{fieldSelect("clientField")}<Label labelFor="client-values">Allowed client values (comma separated)</Label><Textfield id="client-values" value={(config.clientValues || []).join(", ")} onChange={(e) => patch("clientValues", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></>}
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">Hardware handover safety</Heading>
      <Label labelFor="hw-type">HW issue type</Label><Textfield id="hw-type" value={config.hwIssueType} onChange={(e) => patch("hwIssueType", e.target.value)} placeholder="Leave blank while auto-creation is off" />
      <Label labelFor="link-type">Issue link type</Label><Textfield id="link-type" value={config.hwLinkType} onChange={(e) => patch("hwLinkType", e.target.value)} />
      <Toggle isChecked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} label="Add internal automated comments" />
      <Toggle isChecked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} label="Allow workflow transitions" />
      <Toggle isChecked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} label="Automatically create missing HW tickets" />
      {config.createEnabled && <MessageBanner appearance="warning">Only enable HW ticket creation after reconciliation-only testing has passed. It remains OFF by default.</MessageBanner>}
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">DHL polling</Heading>
      <Label labelFor="min-days">Minimum days since Date Sent</Label><Textfield id="min-days" type="number" value={String(config.minDaysSinceSent)} onChange={(e) => patch("minDaysSinceSent", Number(e.target.value))} />
      <Label labelFor="batch">Maximum DHL checks per polling cycle</Label><Textfield id="batch" type="number" value={String(config.dhlBatchSize)} onChange={(e) => patch("dhlBatchSize", Number(e.target.value))} />
      <Text>Scheduler cadence remains approximately every 15 minutes, with hardware reconciliation every 5 minutes.</Text>
    </Stack></Box>

    <Box xcss={sectionStyle}><Stack space="space.200"><Heading as="h2">Validation</Heading><Text>Validation checks projects, field mappings, all configured workflow statuses, client restrictions and HW auto-creation safety.</Text>
      <Box><Button appearance="primary" onClick={validate} isDisabled={busy}>Validate configuration</Button> <Button onClick={save} isDisabled={busy}>Save settings</Button></Box>
      {validation?.checks?.map((check) => <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.key}: {check.message}</Text>)}
    </Stack></Box>
  </Stack>;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
