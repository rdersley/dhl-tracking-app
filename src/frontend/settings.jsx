import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Heading, Inline, Label, MessageBanner, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import { invoke } from "@forge/bridge";

const UI_BUILD = "DM-COMBINED-RC-20260904-UI4";
const pageStyle = xcss({ maxWidth: "1240px" });
const heroStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "color.background.neutral.subtle" });
const tabsStyle = xcss({ paddingBlock: "space.100", borderBottomWidth: "border.width", borderBottomStyle: "solid", borderBottomColor: "color.border" });
const sectionStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "elevation.surface", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const subSectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.neutral.subtle" });
const fieldColumnStyle = xcss({ width: "49%", minWidth: "320px" });
const statusOkStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.success" });
const statusWarnStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.warning" });
const toggleRowStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.neutral.subtle", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const mappingRowStyle = xcss({ padding: "space.150", borderRadius: "border.radius.200", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const infoStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.information" });

const FALLBACK_CONFIG = {
  sdProject: "SD", hwProject: "HW", sdSentStatus: "Sent to Hardware", hwDispatchedStatus: "Dispatched", sdDispatchedStatus: "Dispatched",
  outForDeliveryStatus: "OUT FOR DELIVERY", awaitingCollectionStatus: "DELIVERY AWAITING COLLECTION", onHoldStatus: "DELIVERY ON HOLD", failedStatus: "DELIVERY FAILED", resolvedStatus: "Resolved",
  trackingField: "customfield_10417", dateSentField: "customfield_10433", deliveryStatusField: "customfield_11952", deliveryDateField: "customfield_10434", signedForField: "customfield_10442", lastDhlCheckField: "customfield_14400",
  clientField: "", clientRestrictionEnabled: false, clientValues: [], hwIssueType: "", hwLinkType: "Relates", hwFieldMappings: [], commentsEnabled: true, transitionsEnabled: true, createEnabled: false,
  maxResults: 100, dhlBatchSize: 10, dhlDelayMs: 3000, minDaysSinceSent: 3,
  dhlApiUrl: "https://api-eu.dhl.com/track/shipments", dhlAccountNumber: "", dhlApiKeyConfigured: false,
};

const TABS = [
  { id: "general", label: "General" },
  { id: "hardware", label: "Hardware Creation" },
  { id: "tracking", label: "Dispatch & DHL" },
  { id: "api", label: "API & Integration" },
  { id: "mapping", label: "Field Mapping" },
  { id: "automation", label: "Safety & Automation" },
  { id: "validation", label: "Validation" },
];

const optionFor = (options, value) => options.find((item) => item.value === value) || (value ? { label: value, value } : null);
const labelForField = (fields, value) => fields.find((item) => item.value === value)?.label || value || "Unknown field";
const withTimeout = (promise, label, timeoutMs = 12000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs))]);
const looksHealthy = (text) => /loaded successfully|loaded:|Project statuses loaded/.test(text || "");

function FieldBlock({ label, children, help }) {
  return <Stack space="space.075"><Label>{label}</Label>{children}{help ? <Text>{help}</Text> : null}</Stack>;
}
function SectionHeader({ title, description }) {
  return <Stack space="space.050"><Heading as="h2">{title}</Heading>{description ? <Text>{description}</Text> : null}</Stack>;
}
function ToggleRow({ label, description, checked, onChange, warning }) {
  return <Box xcss={toggleRowStyle}><Inline spread="space-between" alignBlock="center" space="space.200"><Stack space="space.050"><Text>{label}</Text><Text>{description}</Text>{warning ? <Text>{warning}</Text> : null}</Stack><Toggle isChecked={Boolean(checked)} onChange={onChange} /></Inline></Box>;
}

function App() {
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [projects, setProjects] = useState([]);
  const [fields, setFields] = useState([]);
  const [sdStatuses, setSdStatuses] = useState([]);
  const [hwStatuses, setHwStatuses] = useState([]);
  const [mappingSource, setMappingSource] = useState("");
  const [mappingTarget, setMappingTarget] = useState("");
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [apiKey, setApiKey] = useState("");
  const [apiTest, setApiTest] = useState(null);
  const [configStatus, setConfigStatus] = useState("Loading saved settings…");
  const [optionsStatus, setOptionsStatus] = useState("Loading Jira projects and fields…");
  const [statusStatus, setStatusStatus] = useState("Loading project statuses…");

  useEffect(() => {
    withTimeout(invoke("getConfig"), "Saved settings request").then((saved) => {
      setConfig((current) => ({ ...current, ...(saved || {}), hwFieldMappings: saved?.hwFieldMappings || [] }));
      setConfigStatus("Saved settings loaded successfully.");
    }).catch((error) => setConfigStatus(`Saved settings could not be loaded: ${String(error)}`));
    withTimeout(invoke("getOptions"), "Jira options request").then((options) => {
      setProjects(options?.projects || []); setFields(options?.fields || []);
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
      setSdStatuses(sdResult?.statuses || []); setHwStatuses(hwResult?.statuses || []);
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
      setMessage({ appearance: "success", text: "Settings saved successfully." });
    } catch (error) { setMessage({ appearance: "error", text: `Could not save settings: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const saveApiKey = async () => {
    setBusy(true); setApiTest(null);
    try {
      const result = await withTimeout(invoke("saveDhlCredentials", { apiKey }), "Save DHL credentials");
      if (result?.ok) {
        setConfig((current) => ({ ...current, dhlApiKeyConfigured: true })); setApiKey("");
        setMessage({ appearance: "success", text: result.message || "DHL API key saved securely." });
      } else setMessage({ appearance: "warning", text: result?.message || "Could not save DHL API key." });
    } catch (error) { setMessage({ appearance: "error", text: `Could not save DHL credentials: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const clearApiKey = async () => {
    setBusy(true); setApiTest(null);
    try {
      const result = await invoke("saveDhlCredentials", { clear: true });
      setConfig((current) => ({ ...current, dhlApiKeyConfigured: false })); setApiKey("");
      setMessage({ appearance: "success", text: result?.message || "DHL API key cleared." });
    } catch (error) { setMessage({ appearance: "error", text: `Could not clear DHL credentials: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const testApi = async () => {
    setBusy(true); setApiTest(null);
    try {
      await save();
      const result = await withTimeout(invoke("testDhlConnection", { config }), "DHL connection test", 30000);
      setApiTest(result); setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.message || "DHL connection test completed." });
    } catch (error) { setMessage({ appearance: "error", text: `DHL connection test failed: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    setBusy(true); setValidation(null);
    try {
      const result = await withTimeout(invoke("validateConfig", { config }), "Validation request", 30000);
      setValidation(result); setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.ok ? "Configuration is valid for controlled testing." : "Configuration needs attention before testing." }); setActiveTab("validation");
    } catch (error) { setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const addMapping = () => {
    if (!mappingSource || !mappingTarget) return setMessage({ appearance: "warning", text: "Choose both a Service Desk source field and Hardware target field." });
    if ((config.hwFieldMappings || []).some((item) => item.target === mappingTarget)) return setMessage({ appearance: "warning", text: "That Hardware target field is already mapped." });
    patch("hwFieldMappings", [...(config.hwFieldMappings || []), { source: mappingSource, target: mappingTarget }]); setMappingSource(""); setMappingTarget("");
  };
  const removeMapping = (index) => patch("hwFieldMappings", (config.hwFieldMappings || []).filter((_, itemIndex) => itemIndex !== index));
  const allConnectionsHealthy = looksHealthy(configStatus) && looksHealthy(optionsStatus) && looksHealthy(statusStatus);

  const generalTab = <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Project configuration" description="Choose the Jira projects used by Delivery Manager." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="Service project" help="Customer requests live here.">{projectSelect("sdProject")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Hardware project" help="Hardware tickets are created here.">{projectSelect("hwProject")}</FieldBlock></Box></Inline></Stack></Box>
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Workflow statuses" description="Define the statuses that connect Service Desk and Hardware." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="SD handover trigger">{statusSelect("sdSentStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="HW dispatched">{statusSelect("hwDispatchedStatus", hwStatuses, "No HW statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="SD dispatched">{statusSelect("sdDispatchedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box></Inline></Stack></Box>
    <Box xcss={allConnectionsHealthy ? statusOkStyle : statusWarnStyle}><Stack space="space.075"><Heading as="h3">{allConnectionsHealthy ? "Connection status — ready" : "Connection status — needs attention"}</Heading><Text>{configStatus}</Text><Text>{optionsStatus}</Text><Text>{statusStatus}</Text></Stack></Box>
  </Stack>;

  const hardwareTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Hardware ticket creation" description="Configure how Delivery Manager creates and links Hardware tickets." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="HW issue type"><Textfield value={config.hwIssueType} onChange={(e) => patch("hwIssueType", e.target.value)} placeholder="Task or Hardware Request" /></FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Issue link type"><Textfield value={config.hwLinkType} onChange={(e) => patch("hwLinkType", e.target.value)} /></FieldBlock></Box></Inline></Stack></Box><Box xcss={subSectionStyle}><Stack space="space.100"><Heading as="h3">Duplicate protection</Heading><Text>Delivery Manager checks existing links and its own recorded creation history before creating a Hardware ticket, then checks again immediately before creation.</Text></Stack></Box></Stack>;

  const trackingTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="DHL delivery workflow" description="Map DHL events to Service Desk statuses." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="Out for Delivery">{statusSelect("outForDeliveryStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Awaiting Collection">{statusSelect("awaitingCollectionStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="On Hold">{statusSelect("onHoldStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Failed">{statusSelect("failedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Resolved">{statusSelect("resolvedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box></Inline></Stack></Box><Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Polling" description="Control DHL polling volume and age rules." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="Minimum days since Date Sent"><Textfield type="number" value={String(config.minDaysSinceSent)} onChange={(e) => patch("minDaysSinceSent", Number(e.target.value))} /></FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Maximum DHL checks per cycle"><Textfield type="number" value={String(config.dhlBatchSize)} onChange={(e) => patch("dhlBatchSize", Number(e.target.value))} /></FieldBlock></Box></Inline></Stack></Box></Stack>;

  const apiTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="DHL API configuration" description="Configure the DHL connection here. Credentials are encrypted per Jira installation and are never displayed again after saving." /><Box xcss={config.dhlApiKeyConfigured ? statusOkStyle : statusWarnStyle}><Text>{config.dhlApiKeyConfigured ? "API key configured securely" : "API key not configured"}</Text></Box><FieldBlock label="DHL tracking API URL" help="For security, this build only allows HTTPS endpoints on api-eu.dhl.com."><Textfield value={config.dhlApiUrl || ""} onChange={(e) => patch("dhlApiUrl", e.target.value)} /></FieldBlock><FieldBlock label="DHL account number (optional)" help="Stored for future shipment-creation support; not currently required for tracking."><Textfield value={config.dhlAccountNumber || ""} onChange={(e) => patch("dhlAccountNumber", e.target.value)} /></FieldBlock><FieldBlock label="DHL API key" help={config.dhlApiKeyConfigured ? "A key is already stored. Enter a new key only if you want to replace it." : "Paste your DHL API key, then save credentials."}><Textfield type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.dhlApiKeyConfigured ? "••••••••••••••••" : "Enter DHL API key"} /></FieldBlock><Inline space="space.100" shouldWrap><Button appearance="primary" onClick={saveApiKey} isDisabled={busy || !apiKey}>Save API key securely</Button><Button onClick={testApi} isDisabled={busy || !config.dhlApiKeyConfigured}>Test connection</Button>{config.dhlApiKeyConfigured ? <Button appearance="subtle" onClick={clearApiKey} isDisabled={busy}>Clear API key</Button> : null}</Inline>{apiTest ? <Box xcss={apiTest.ok ? statusOkStyle : statusWarnStyle}><Text>{apiTest.message}</Text></Box> : null}</Stack></Box><Box xcss={infoStyle}><Stack space="space.075"><Heading as="h3">Security</Heading><Text>The API key is stored using Forge encrypted secret storage, not normal app settings and not in the source code.</Text><Text>The endpoint is configurable but restricted to the approved DHL domain because Forge requires outbound domains to be declared in the app manifest.</Text></Stack></Box></Stack>;

  const mappingTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Core Jira fields" description="Choose the fields Delivery Manager reads and updates." /><Inline space="space.200" shouldWrap>{[["Tracking Number","trackingField"],["Date Sent","dateSentField"],["Delivery Status","deliveryStatusField"],["Date Delivered","deliveryDateField"],["Signed For","signedForField"],["Last DHL Check","lastDhlCheckField"]].map(([label,key]) => <Box xcss={fieldColumnStyle} key={key}><FieldBlock label={label}>{fieldSelect(key)}</FieldBlock></Box>)}</Inline></Stack></Box><Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Additional SD → HW mappings" description="Copy extra Service Desk fields into Hardware tickets." /><Inline space="space.200" shouldWrap><Box xcss={fieldColumnStyle}><FieldBlock label="Source field"><Select options={fields} value={optionFor(fields, mappingSource)} onChange={(option) => setMappingSource(option?.value || "")} /></FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Target field"><Select options={fields} value={optionFor(fields, mappingTarget)} onChange={(option) => setMappingTarget(option?.value || "")} /></FieldBlock></Box></Inline><Button appearance="primary" onClick={addMapping}>Add mapping</Button>{(config.hwFieldMappings || []).length === 0 ? <Text>No additional mappings configured.</Text> : null}{(config.hwFieldMappings || []).map((m,i) => <Box xcss={mappingRowStyle} key={`${m.source}-${m.target}-${i}`}><Inline spread="space-between"><Text>{labelForField(fields,m.source)} → {labelForField(fields,m.target)}</Text><Button appearance="subtle" onClick={() => removeMapping(i)}>Remove</Button></Inline></Box>)}</Stack></Box></Stack>;

  const automationTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Safety & automation" description="Control exactly what Delivery Manager may do automatically." /><ToggleRow label="Add internal automated comments" description="Adds private comments when the app creates, repairs or updates tickets." checked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} /><ToggleRow label="Allow workflow transitions" description="Allows the app to move issues to configured statuses when conditions are met." checked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} /><ToggleRow label="Automatically create missing HW tickets" description="Allows scheduled reconciliation to create missing Hardware tickets." warning="Keep this OFF during sandbox validation." checked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} />{config.createEnabled ? <MessageBanner appearance="warning">Automatic Hardware creation is enabled.</MessageBanner> : <Box xcss={infoStyle}><Text>Automatic Hardware creation is OFF — recommended during sandbox testing.</Text></Box>}</Stack></Box></Stack>;

  const validationTab = <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Configuration validation" description="Validate Jira setup, DHL API configuration, mappings and automation safety." /><Inline space="space.100"><Button appearance="primary" onClick={validate} isDisabled={busy}>Run validation</Button><Button onClick={save} isDisabled={busy}>Save settings</Button></Inline>{validation?.checks?.length ? <Box xcss={subSectionStyle}><Stack space="space.075">{validation.checks.map((check) => <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.key}: {check.message}</Text>)}</Stack></Box> : <Text>No validation run yet.</Text>}</Stack></Box></Stack>;

  const content = activeTab === "hardware" ? hardwareTab : activeTab === "tracking" ? trackingTab : activeTab === "api" ? apiTab : activeTab === "mapping" ? mappingTab : activeTab === "automation" ? automationTab : activeTab === "validation" ? validationTab : generalTab;

  return <Box xcss={pageStyle}><Stack space="space.250"><Box xcss={heroStyle}><Inline spread="space-between" alignBlock="center" shouldWrap><Stack space="space.075"><Heading as="h1">Delivery Manager</Heading><Text>Hardware handover, dispatch, DHL tracking and delivery resolution.</Text><Text>UI build: {UI_BUILD}</Text></Stack><Inline space="space.100"><Button onClick={validate} isDisabled={busy}>Validate settings</Button><Button appearance="primary" onClick={save} isDisabled={busy}>Save changes</Button></Inline></Inline></Box>{message ? <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner> : null}<Box xcss={tabsStyle}><Inline space="space.050" shouldWrap>{TABS.map((tab) => <Button key={tab.id} appearance={activeTab === tab.id ? "primary" : "subtle"} onClick={() => setActiveTab(tab.id)}>{tab.label}</Button>)}</Inline></Box>{content}</Stack></Box>;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
