import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Heading, Inline, Label, MessageBanner, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import { invoke } from "@forge/bridge";

const UI_BUILD = "DM-COMBINED-RC-20260904-UI3";

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
};

const TABS = [
  { id: "general", label: "General" },
  { id: "hardware", label: "Hardware Creation" },
  { id: "tracking", label: "Dispatch & DHL" },
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

function ToggleRow({ id, label, description, checked, onChange, warning }) {
  return <Box xcss={toggleRowStyle}>
    <Inline spread="space-between" alignBlock="center" space="space.200">
      <Stack space="space.050">
        <Label labelFor={id}>{label}</Label>
        <Text>{description}</Text>
        {warning ? <Text>{warning}</Text> : null}
      </Stack>
      <Toggle id={id} isChecked={Boolean(checked)} onChange={onChange} />
    </Inline>
  </Box>;
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
  const [configStatus, setConfigStatus] = useState("Loading saved settings…");
  const [optionsStatus, setOptionsStatus] = useState("Loading Jira projects and fields…");
  const [statusStatus, setStatusStatus] = useState("Loading project statuses…");

  useEffect(() => {
    withTimeout(invoke("getConfig"), "Saved settings request").then((saved) => {
      setConfig((current) => ({ ...current, ...(saved || {}), hwFieldMappings: saved?.hwFieldMappings || [] }));
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

  const addMapping = () => {
    if (!mappingSource || !mappingTarget) return setMessage({ appearance: "warning", text: "Choose both a Service Desk source field and Hardware target field." });
    if ((config.hwFieldMappings || []).some((item) => item.target === mappingTarget)) return setMessage({ appearance: "warning", text: "That Hardware target field is already mapped." });
    patch("hwFieldMappings", [...(config.hwFieldMappings || []), { source: mappingSource, target: mappingTarget }]);
    setMappingSource("");
    setMappingTarget("");
    setMessage({ appearance: "success", text: "Field mapping added. Save settings when you are ready." });
  };

  const removeMapping = (index) => patch("hwFieldMappings", (config.hwFieldMappings || []).filter((_, itemIndex) => itemIndex !== index));

  const save = async () => {
    setBusy(true);
    try {
      const result = await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      setConfig((current) => ({ ...current, ...(result?.config || {}) }));
      setMessage({ appearance: "success", text: "Settings saved successfully." });
    } catch (error) { setMessage({ appearance: "error", text: `Could not save settings: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    setBusy(true); setValidation(null);
    try {
      const result = await withTimeout(invoke("validateConfig", { config }), "Validation request", 30000);
      setValidation(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.ok ? "Configuration is valid for controlled testing." : "Configuration needs attention before testing." });
      setActiveTab("validation");
    } catch (error) { setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` }); }
    finally { setBusy(false); }
  };

  const allConnectionsHealthy = looksHealthy(configStatus) && looksHealthy(optionsStatus) && looksHealthy(statusStatus);

  const renderGeneral = () => <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Project configuration" description="Choose the Jira projects used by Delivery Manager." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="Service project" help="The project where customer requests are logged.">{projectSelect("sdProject")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware project" help="The project where hardware tickets are created and managed.">{projectSelect("hwProject")}</FieldBlock></Box>
      </Inline></Stack></Box>
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Workflow status configuration" description="Define the key statuses that connect Service Desk and Hardware." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="SD status that triggers hardware handover" help="When an SD ticket reaches this status, it becomes eligible for hardware handover.">{statusSelect("sdSentStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="HW dispatched status" help="The Hardware status that means the replacement has been sent.">{statusSelect("hwDispatchedStatus", hwStatuses, "No HW statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="SD dispatched status" help="The Service Desk status applied after tracking details are copied back from HW.">{statusSelect("sdDispatchedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
      </Inline></Stack></Box>
    <Box xcss={allConnectionsHealthy ? statusOkStyle : statusWarnStyle}><Stack space="space.075"><Heading as="h3">{allConnectionsHealthy ? "Connection status — ready" : "Connection status — needs attention"}</Heading><Text>{configStatus}</Text><Text>{optionsStatus}</Text><Text>{statusStatus}</Text></Stack></Box>
  </Stack>;

  const renderHardware = () => <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Hardware ticket creation" description="Configure how Delivery Manager creates and links a Hardware ticket from an SD request." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="HW issue type" help="The issue type used when creating the Hardware ticket."><Textfield value={config.hwIssueType} onChange={(e) => patch("hwIssueType", e.target.value)} placeholder="For example Task or Hardware Request" /></FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Issue link type" help="The Jira link type used between the SD request and Hardware ticket."><Textfield value={config.hwLinkType} onChange={(e) => patch("hwLinkType", e.target.value)} /></FieldBlock></Box>
      </Inline></Stack></Box>
    <Box xcss={subSectionStyle}><Stack space="space.100"><Heading as="h3">How duplicate protection works</Heading><Text>Before creating a Hardware ticket, Delivery Manager checks existing issue links and its own recorded creation history, then performs a second server-side check immediately before creation.</Text><Text>If a Hardware ticket already exists, the manual action warns the user instead of silently creating another one.</Text></Stack></Box>
  </Stack>;

  const renderTracking = () => <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="DHL delivery workflow" description="Map DHL delivery events to your Service Desk workflow statuses." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="Out for Delivery">{statusSelect("outForDeliveryStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Awaiting Collection">{statusSelect("awaitingCollectionStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="On Hold">{statusSelect("onHoldStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Failed">{statusSelect("failedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Final Resolved status">{statusSelect("resolvedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
      </Inline></Stack></Box>
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="DHL polling" description="Control which dispatched tickets are checked and how many are processed in each polling cycle." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="Minimum days since Date Sent" help="Only tickets at least this old are included in DHL polling."><Textfield type="number" value={String(config.minDaysSinceSent)} onChange={(e) => patch("minDaysSinceSent", Number(e.target.value))} /></FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Maximum DHL checks per cycle" help="Caps the number of DHL requests made during one run."><Textfield type="number" value={String(config.dhlBatchSize)} onChange={(e) => patch("dhlBatchSize", Number(e.target.value))} /></FieldBlock></Box>
      </Inline><Text>DHL polling runs approximately every 15 minutes. Hardware reconciliation continues every 5 minutes.</Text></Stack></Box>
    <Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Client restrictions" description="Optionally restrict DHL tracking to selected client values." />
      <ToggleRow id="client-restriction" label="Restrict tracking by client" description="When enabled, only issues whose configured client field matches one of the allowed values will be polled." checked={config.clientRestrictionEnabled} onChange={(e) => patch("clientRestrictionEnabled", e.target.checked)} />
      {config.clientRestrictionEnabled ? <Inline space="space.200" shouldWrap alignBlock="start"><Box xcss={fieldColumnStyle}><FieldBlock label="Client field" help="The Jira field that identifies the client.">{fieldSelect("clientField")}</FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Allowed client values" help="Enter values separated by commas."><Textfield value={(config.clientValues || []).join(", ")} onChange={(e) => patch("clientValues", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></FieldBlock></Box></Inline> : null}
    </Stack></Box>
  </Stack>;

  const renderMapping = () => <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Core Jira fields" description="Select the Jira fields Delivery Manager reads and updates during dispatch and delivery tracking." />
      <Inline space="space.200" shouldWrap alignBlock="start">
        <Box xcss={fieldColumnStyle}><FieldBlock label="Tracking Number" help="The DHL tracking number.">{fieldSelect("trackingField")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Date Sent" help="The date the hardware was dispatched.">{fieldSelect("dateSentField")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Status" help="The latest delivery state returned by DHL.">{fieldSelect("deliveryStatusField")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Date Delivered" help="Populated when DHL confirms delivery.">{fieldSelect("deliveryDateField")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Signed For" help="Stores the recipient/signature name where available.">{fieldSelect("signedForField")}</FieldBlock></Box>
        <Box xcss={fieldColumnStyle}><FieldBlock label="Last DHL Check" help="Timestamp of the most recent tracking check.">{fieldSelect("lastDhlCheckField")}</FieldBlock></Box>
      </Inline></Stack></Box>
    <Box xcss={sectionStyle}><Stack space="space.250"><SectionHeader title="Additional SD → HW mappings" description="Add extra Service Desk fields that should be copied into the Hardware ticket when it is created." />
      <Inline space="space.200" shouldWrap alignBlock="end"><Box xcss={fieldColumnStyle}><FieldBlock label="Service Desk source field"><Select options={fields} value={optionFor(fields, mappingSource)} onChange={(option) => setMappingSource(option?.value || "")} placeholder="Select source field" /></FieldBlock></Box><Box xcss={fieldColumnStyle}><FieldBlock label="Hardware target field"><Select options={fields} value={optionFor(fields, mappingTarget)} onChange={(option) => setMappingTarget(option?.value || "")} placeholder="Select target field" /></FieldBlock></Box></Inline>
      <Box><Button appearance="primary" onClick={addMapping}>Add field mapping</Button></Box>
      {(config.hwFieldMappings || []).length === 0 ? <Box xcss={subSectionStyle}><Text>No additional field mappings configured.</Text></Box> : null}
      {(config.hwFieldMappings || []).map((mapping, index) => <Box xcss={mappingRowStyle} key={`${mapping.source}-${mapping.target}-${index}`}><Inline spread="space-between" alignBlock="center" space="space.200"><Text>{labelForField(fields, mapping.source)} → {labelForField(fields, mapping.target)}</Text><Button appearance="subtle" onClick={() => removeMapping(index)}>Remove</Button></Inline></Box>)}
    </Stack></Box>
  </Stack>;

  const renderAutomation = () => <Stack space="space.250">
    <Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Safety & automation" description="These switches control what Delivery Manager is allowed to do automatically." />
      <ToggleRow id="comments-enabled" label="Add internal automated comments" description="Adds a private Jira comment when Delivery Manager creates, repairs or updates a ticket so agents can see what happened." checked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} />
      <ToggleRow id="transitions-enabled" label="Allow workflow transitions" description="Allows Delivery Manager to move Jira issues between the configured workflow statuses when the required conditions are met." checked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} />
      <ToggleRow id="auto-create-enabled" label="Automatically create missing HW tickets" description="When enabled, the scheduled reconciliation can create a missing Hardware ticket for an eligible SD request." warning="Keep this OFF during sandbox validation. Manual Create Hardware Ticket remains available for controlled testing." checked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} />
      {config.createEnabled ? <MessageBanner appearance="warning">Automatic Hardware creation is enabled. Only use this after manual creation and duplicate-protection tests have passed.</MessageBanner> : <Box xcss={infoStyle}><Text>Automatic Hardware creation is currently OFF. This is the recommended setting while testing in the sandbox.</Text></Box>}
    </Stack></Box>
  </Stack>;

  const renderValidation = () => <Stack space="space.250"><Box xcss={sectionStyle}><Stack space="space.200"><SectionHeader title="Configuration validation" description="Check projects, statuses, Jira fields, mappings, client restrictions and Hardware creation safety before testing." /><Inline space="space.100" shouldWrap><Button appearance="primary" onClick={validate} isDisabled={busy}>Run validation</Button><Button onClick={save} isDisabled={busy}>Save settings</Button></Inline>{validation?.checks?.length ? <Box xcss={subSectionStyle}><Stack space="space.100"><Heading as="h3">Validation results</Heading>{validation.checks.map((check) => <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.message}</Text>)}</Stack></Box> : <Text>No validation run yet in this session.</Text>}</Stack></Box></Stack>;

  const renderActiveTab = () => {
    if (activeTab === "hardware") return renderHardware();
    if (activeTab === "tracking") return renderTracking();
    if (activeTab === "mapping") return renderMapping();
    if (activeTab === "automation") return renderAutomation();
    if (activeTab === "validation") return renderValidation();
    return renderGeneral();
  };

  return <Box xcss={pageStyle}><Stack space="space.250">
    <Box xcss={heroStyle}><Inline spread="space-between" alignBlock="center" space="space.250" shouldWrap><Stack space="space.075"><Heading as="h1">Delivery Manager</Heading><Text>Hardware handover, dispatch, DHL tracking and delivery resolution.</Text><Text>UI build: {UI_BUILD}</Text></Stack><Inline space="space.100" shouldWrap><Button onClick={validate} isDisabled={busy}>Validate settings</Button><Button appearance="primary" onClick={save} isDisabled={busy}>Save changes</Button></Inline></Inline></Box>
    {message ? <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner> : null}
    <Box xcss={tabsStyle}><Inline space="space.050" shouldWrap>{TABS.map((tab) => <Button key={tab.id} appearance={activeTab === tab.id ? "primary" : "subtle"} onClick={() => setActiveTab(tab.id)}>{tab.label}</Button>)}</Inline></Box>
    {renderActiveTab()}
  </Stack></Box>;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
