import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Heading, Inline, Label, MessageBanner, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import { invoke } from "@forge/bridge";

const UI_BUILD = "DM-COMBINED-RC-20260905-UI7";

const pageStyle = xcss({ maxWidth: "1240px" });
const heroStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "color.background.neutral.subtle" });
const tabsStyle = xcss({ paddingBlock: "space.100", borderBottomWidth: "border.width", borderBottomStyle: "solid", borderBottomColor: "color.border" });
const sectionStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "elevation.surface", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const subSectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.neutral.subtle" });
const fieldColumnStyle = xcss({ width: "49%", minWidth: "320px" });
const statusOkStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.success" });
const statusWarnStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.warning" });
const infoStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.information" });
const toggleRowStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.neutral.subtle", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const mappingRowStyle = xcss({ padding: "space.150", borderRadius: "border.radius.200", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });

const FALLBACK_CONFIG = {
  sdProject: "SD",
  hwProject: "HW",
  sdSentStatus: "Sent to Hardware",
  hwDispatchedStatus: "Dispatched",
  sdDispatchedStatus: "Dispatched",
  resolvedStatus: "Resolved",
  resolutionName: "Done",
  outForDeliveryStatus: "OUT FOR DELIVERY",
  awaitingCollectionStatus: "DELIVERY AWAITING COLLECTION",
  onHoldStatus: "DELIVERY ON HOLD",
  failedStatus: "DELIVERY FAILED",
  trackingField: "customfield_10417",
  dateSentField: "customfield_10433",
  deliveryStatusField: "customfield_11952",
  deliveryDateField: "customfield_10434",
  signedForField: "customfield_10442",
  lastDhlCheckField: "customfield_14400",
  clientField: "",
  clientRestrictionEnabled: false,
  clientValues: [],
  hwIssueType: "",
  hwLinkType: "Relates",
  hwFieldMappings: [],
  commentsEnabled: true,
  transitionsEnabled: true,
  createEnabled: false,
  maxResults: 100,
  dhlBatchSize: 10,
  dhlDelayMs: 3000,
  minDaysSinceSent: 3,
  dhlApiUrl: "https://api-eu.dhl.com/track/shipments",
  dhlAccountNumber: "",
  dhlApiKeyConfigured: false,
  dhlShippingEnabled: false,
  dhlShippingEnvironment: "test",
  dhlShippingApiUrl: "https://express.api.dhl.com/mydhlapi/test",
  dhlShippingAccountNumber: "",
  dhlProductCode: "",
  dhlPickupRequestedByDefault: false,
  dhlShippingCredentialsConfigured: false,
  deliveredValue: "Delivered",
  inTransitValue: "In Transit",
  outForDeliveryValue: "Out for Delivery",
  awaitingCollectionValue: "Awaiting Collection",
  onHoldValue: "On Hold",
  failedValue: "Delivery Failed",
};

const TABS = [
  { id: "general", label: "General" },
  { id: "hardware", label: "Hardware Creation" },
  { id: "tracking", label: "Dispatch & DHL" },
  { id: "api", label: "API & Integration" },
  { id: "mapping", label: "Field Mapping" },
  { id: "automation", label: "Safety & Automation" },
  { id: "diagnostics", label: "Diagnostics" },
];

const optionFor = (options, value) => options.find((item) => item.value === value) || (value ? { label: value, value } : null);
const labelForField = (fields, value) => fields.find((item) => item.value === value)?.label || value || "Unknown field";
const withTimeout = (promise, label, timeoutMs = 12000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
]);
const looksHealthy = (text) => /loaded successfully|loaded:|Project statuses loaded/.test(text || "");

function FieldBlock({ label, children, help }) {
  return <Stack space="space.075">
    <Label>{label}</Label>
    {children}
    {help ? <Text>{help}</Text> : null}
  </Stack>;
}

function SectionHeader({ title, description }) {
  return <Stack space="space.050">
    <Heading as="h2">{title}</Heading>
    {description ? <Text>{description}</Text> : null}
  </Stack>;
}

function ToggleRow({ label, description, checked, onChange, warning }) {
  return <Box xcss={toggleRowStyle}>
    <Inline spread="space-between" alignBlock="center" space="space.200">
      <Stack space="space.050">
        <Text>{label}</Text>
        <Text>{description}</Text>
        {warning ? <Text>{warning}</Text> : null}
      </Stack>
      <Toggle isChecked={Boolean(checked)} onChange={onChange} />
    </Inline>
  </Box>;
}

function App() {
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [projects, setProjects] = useState([]);
  const [fields, setFields] = useState([]);
  const [issueTypes, setIssueTypes] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [resolutions, setResolutions] = useState([]);
  const [sdStatuses, setSdStatuses] = useState([]);
  const [hwStatuses, setHwStatuses] = useState([]);
  const [mappingSource, setMappingSource] = useState("");
  const [mappingTarget, setMappingTarget] = useState("");
  const [validation, setValidation] = useState(null);
  const [preview, setPreview] = useState(null);
  const [runtimeHealth, setRuntimeHealth] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [apiKey, setApiKey] = useState("");
  const [apiTest, setApiTest] = useState(null);
  const [shippingUsername, setShippingUsername] = useState("");
  const [shippingPassword, setShippingPassword] = useState("");
  const [shippingTest, setShippingTest] = useState(null);
  const [configStatus, setConfigStatus] = useState("Loading saved settings…");
  const [optionsStatus, setOptionsStatus] = useState("Loading Jira configuration options…");
  const [statusStatus, setStatusStatus] = useState("Loading project statuses…");

  useEffect(() => {
    withTimeout(invoke("getConfig"), "Saved settings request").then((saved) => {
      setConfig((current) => ({ ...current, ...(saved || {}), hwFieldMappings: saved?.hwFieldMappings || [] }));
      setConfigStatus("Saved settings loaded successfully.");
    }).catch((error) => setConfigStatus(`Saved settings could not be loaded: ${String(error)}`));

    withTimeout(invoke("getOptions"), "Jira options request").then((options) => {
      setProjects(options?.projects || []);
      setFields(options?.fields || []);
      setIssueTypes(options?.issueTypes || []);
      setLinkTypes(options?.linkTypes || []);
      setResolutions(options?.resolutions || []);
      setOptionsStatus(`Jira options loaded: ${options?.projects?.length || 0} projects, ${options?.fields?.length || 0} fields, ${options?.issueTypes?.length || 0} issue types.`);
    }).catch((error) => setOptionsStatus(`Jira options could not be loaded: ${String(error)}`));

    withTimeout(invoke("getRuntimeHealth"), "Runtime health request").then((health) => {
      setRuntimeHealth(health || null);
    }).catch(() => setRuntimeHealth(null));
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
      const problems = [
        sdResult?.ok ? null : `SD: ${sdResult?.error || "could not load"}`,
        hwResult?.ok ? null : `HW: ${hwResult?.error || "could not load"}`,
      ].filter(Boolean);
      setStatusStatus(problems.length ? `Status loading issue — ${problems.join(" | ")}` : `Project statuses loaded: ${sdResult?.statuses?.length || 0} SD statuses, ${hwResult?.statuses?.length || 0} HW statuses.`);
    }).catch((error) => {
      if (!cancelled) setStatusStatus(`Project statuses could not be loaded: ${String(error)}`);
    });
    return () => { cancelled = true; };
  }, [config.sdProject, config.hwProject]);

  const patch = (key, value) => setConfig((current) => ({ ...current, [key]: value }));
  const projectSelect = (key) => <Select options={projects} value={optionFor(projects, config[key])} onChange={(option) => patch(key, option?.value || "")} />;
  const fieldSelect = (key) => <Select options={fields} value={optionFor(fields, config[key])} onChange={(option) => patch(key, option?.value || "")} />;
  const statusSelect = (key, options, emptyText) => <Select options={options} value={optionFor(options, config[key])} onChange={(option) => patch(key, option?.value || "")} placeholder={options.length ? "Select a Jira status" : emptyText} />;
  const namedSelect = (key, options, placeholder) => <Select options={options} value={optionFor(options, config[key])} onChange={(option) => patch(key, option?.value || "")} placeholder={placeholder} />;

  const save = async () => {
    setBusy(true);
    try {
      const result = await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      setConfig((current) => ({
        ...current,
        ...(result?.config || {}),
        dhlApiKeyConfigured: current.dhlApiKeyConfigured,
        dhlShippingCredentialsConfigured: current.dhlShippingCredentialsConfigured,
      }));
      setMessage({ appearance: "success", text: "Settings saved successfully." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not save settings: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveApiKey = async () => {
    setBusy(true);
    setApiTest(null);
    try {
      const result = await withTimeout(invoke("saveDhlCredentials", { apiKey }), "Save DHL credentials");
      if (result?.ok) {
        setConfig((current) => ({ ...current, dhlApiKeyConfigured: true }));
        setApiKey("");
        setMessage({ appearance: "success", text: result.message || "DHL API key saved securely." });
      } else {
        setMessage({ appearance: "warning", text: result?.message || "Could not save DHL API key." });
      }
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not save DHL credentials: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const clearApiKey = async () => {
    setBusy(true);
    setApiTest(null);
    try {
      const result = await withTimeout(invoke("saveDhlCredentials", { clear: true }), "Clear DHL credentials");
      setConfig((current) => ({ ...current, dhlApiKeyConfigured: false }));
      setApiKey("");
      setMessage({ appearance: "success", text: result?.message || "DHL API key cleared." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not clear DHL credentials: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const testApi = async () => {
    setBusy(true);
    setApiTest(null);
    try {
      await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      const result = await withTimeout(invoke("testDhlConnection", { config }), "DHL connection test", 30000);
      setApiTest(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.message || "DHL connection test completed." });
    } catch (error) {
      setMessage({ appearance: "error", text: `DHL connection test failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveShippingCredentials = async () => {
    setBusy(true);
    setShippingTest(null);
    try {
      const result = await withTimeout(invoke("saveDhlShippingCredentials", { username: shippingUsername, password: shippingPassword }), "Save DHL shipping credentials");
      if (result?.ok) {
        setConfig((current) => ({ ...current, dhlShippingCredentialsConfigured: true }));
        setShippingUsername("");
        setShippingPassword("");
        setMessage({ appearance: "success", text: result.message || "DHL Express shipping credentials saved securely." });
      } else {
        setMessage({ appearance: "warning", text: result?.message || "Could not save DHL Express shipping credentials." });
      }
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not save DHL Express shipping credentials: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const clearShippingCredentials = async () => {
    setBusy(true);
    setShippingTest(null);
    try {
      const result = await withTimeout(invoke("saveDhlShippingCredentials", { clear: true }), "Clear DHL shipping credentials");
      setConfig((current) => ({ ...current, dhlShippingCredentialsConfigured: false, dhlShippingEnabled: false }));
      setShippingUsername("");
      setShippingPassword("");
      setMessage({ appearance: "success", text: result?.message || "DHL Express shipping credentials cleared." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not clear DHL Express shipping credentials: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const testShippingApi = async () => {
    setBusy(true);
    setShippingTest(null);
    try {
      await withTimeout(invoke("saveConfig", { config }), "Save settings request");
      const result = await withTimeout(invoke("testDhlShippingConnection", { config }), "DHL Express connection test", 30000);
      setShippingTest(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.message || "DHL Express connection test completed." });
    } catch (error) {
      setMessage({ appearance: "error", text: `DHL Express connection test failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    setValidation(null);
    try {
      const result = await withTimeout(invoke("validateConfig", { config }), "Validation request", 30000);
      setValidation(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.ok ? "Configuration is valid for controlled testing." : "Configuration needs attention before testing." });
      setActiveTab("diagnostics");
    } catch (error) {
      setMessage({ appearance: "error", text: `Validation failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setPreview(null);
    try {
      const result = await withTimeout(invoke("getOperationalPreview", { config }), "Operational preview", 30000);
      setPreview(result);
      setMessage({ appearance: result?.ok ? "success" : "warning", text: result?.ok ? "Read-only operational preview completed." : "Preview completed with one or more Jira query problems." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Operational preview failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const refreshHealth = async () => {
    setBusy(true);
    try {
      const health = await withTimeout(invoke("getRuntimeHealth"), "Runtime health request");
      setRuntimeHealth(health || null);
      setMessage({ appearance: "success", text: "Runtime health refreshed." });
    } catch (error) {
      setMessage({ appearance: "error", text: `Could not load runtime health: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const addMapping = () => {
    if (!mappingSource || !mappingTarget) {
      setMessage({ appearance: "warning", text: "Choose both a Service Desk source field and Hardware target field." });
      return;
    }
    if ((config.hwFieldMappings || []).some((item) => item.target === mappingTarget)) {
      setMessage({ appearance: "warning", text: "That Hardware target field is already mapped." });
      return;
    }
    patch("hwFieldMappings", [...(config.hwFieldMappings || []), { source: mappingSource, target: mappingTarget }]);
    setMappingSource("");
    setMappingTarget("");
    setMessage({ appearance: "success", text: "Field mapping added. Save changes when you are ready." });
  };

  const removeMapping = (index) => patch("hwFieldMappings", (config.hwFieldMappings || []).filter((_, itemIndex) => itemIndex !== index));
  const allConnectionsHealthy = looksHealthy(configStatus) && looksHealthy(optionsStatus) && looksHealthy(statusStatus);

  const generalTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Project configuration" description="Choose the Jira projects used for customer requests and hardware fulfilment." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Service project" help="Customer replacement requests live here.">{projectSelect("sdProject")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware project" help="Hardware fulfilment tickets are created and managed here.">{projectSelect("hwProject")}</FieldBlock></Box>
        </Inline>
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Hardware handover workflow" description="Define the statuses that connect Service Desk and Hardware." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="SD handover trigger" help="When an SD request reaches this status, it becomes eligible for hardware handover.">{statusSelect("sdSentStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="HW dispatched status" help="The Hardware status that means the replacement has been sent.">{statusSelect("hwDispatchedStatus", hwStatuses, "No HW statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="SD dispatched status" help="Applied after tracking details are copied from HW back to the Service Desk request.">{statusSelect("sdDispatchedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
        </Inline>
      </Stack>
    </Box>

    <Box xcss={allConnectionsHealthy ? statusOkStyle : statusWarnStyle}>
      <Stack space="space.075">
        <Heading as="h3">{allConnectionsHealthy ? "Jira connection ready" : "Jira connection needs attention"}</Heading>
        <Text>{configStatus}</Text>
        <Text>{optionsStatus}</Text>
        <Text>{statusStatus}</Text>
      </Stack>
    </Box>
  </Stack>;

  const hardwareTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Hardware ticket creation" description="Choose how Delivery Manager creates and links Hardware tickets." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="HW issue type" help="Loaded from Jira rather than hardcoded.">{namedSelect("hwIssueType", issueTypes, "Select an issue type")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Issue link type" help="The Jira link type used between the SD request and HW ticket.">{namedSelect("hwLinkType", linkTypes, "Select a link type")}</FieldBlock></Box>
        </Inline>
      </Stack>
    </Box>

    <Box xcss={subSectionStyle}>
      <Stack space="space.100">
        <Heading as="h3">Duplicate protection</Heading>
        <Text>Delivery Manager checks Jira issue links and its own creation history before creating a Hardware ticket, then performs a second server-side check immediately before creation.</Text>
        <Text>The manual action warns when a Hardware ticket already exists and requires an explicit override before another can be created.</Text>
      </Stack>
    </Box>
  </Stack>;

  const trackingTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="DHL workflow mapping" description="Choose the Jira statuses Delivery Manager applies for DHL delivery events." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Out for Delivery">{statusSelect("outForDeliveryStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Awaiting Collection">{statusSelect("awaitingCollectionStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="On Hold">{statusSelect("onHoldStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Failed">{statusSelect("failedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Resolved status">{statusSelect("resolvedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Resolution" help="Optional Jira resolution applied when a delivery is completed.">{namedSelect("resolutionName", resolutions, "Select a resolution")}</FieldBlock></Box>
        </Inline>
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Delivery Status field values" description="Map DHL outcomes to the exact option values used by your Jira Delivery Status field." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Delivered value"><Textfield value={config.deliveredValue || ""} onChange={(e) => patch("deliveredValue", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="In Transit value"><Textfield value={config.inTransitValue || ""} onChange={(e) => patch("inTransitValue", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Out for Delivery value"><Textfield value={config.outForDeliveryValue || ""} onChange={(e) => patch("outForDeliveryValue", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Awaiting Collection value"><Textfield value={config.awaitingCollectionValue || ""} onChange={(e) => patch("awaitingCollectionValue", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="On Hold value"><Textfield value={config.onHoldValue || ""} onChange={(e) => patch("onHoldValue", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Failed value"><Textfield value={config.failedValue || ""} onChange={(e) => patch("failedValue", e.target.value)} /></FieldBlock></Box>
        </Inline>
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Polling controls" description="Tune the scheduler workload without changing source code." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Minimum days since Date Sent" help="Only dispatched tickets at least this old are checked."><Textfield type="number" value={String(config.minDaysSinceSent)} onChange={(e) => patch("minDaysSinceSent", Number(e.target.value))} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Maximum Jira candidates" help="Maximum candidate issues loaded per polling cycle."><Textfield type="number" value={String(config.maxResults)} onChange={(e) => patch("maxResults", Number(e.target.value))} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Maximum DHL checks per cycle" help="Caps outbound DHL calls during one polling cycle."><Textfield type="number" value={String(config.dhlBatchSize)} onChange={(e) => patch("dhlBatchSize", Number(e.target.value))} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Delay between DHL requests (ms)" help="Used to reduce rate-limit pressure. Allowed range is 1000–15000 ms."><Textfield type="number" value={String(config.dhlDelayMs)} onChange={(e) => patch("dhlDelayMs", Number(e.target.value))} /></FieldBlock></Box>
        </Inline>
        <Text>The Forge coordinator runs every five minutes; DHL polling is scheduled on approximately every third cycle.</Text>
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Client restrictions" description="Optionally limit DHL polling to selected client values." />
        <ToggleRow label="Restrict DHL tracking by client" description="When enabled, only tickets matching the configured client field and allowed values are eligible." checked={config.clientRestrictionEnabled} onChange={(e) => patch("clientRestrictionEnabled", e.target.checked)} />
        {config.clientRestrictionEnabled ? <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Client field">{fieldSelect("clientField")}</FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Allowed client values" help="Comma-separated Jira option values."><Textfield value={(config.clientValues || []).join(", ")} onChange={(e) => patch("clientValues", e.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></FieldBlock></Box>
        </Inline> : null}
      </Stack>
    </Box>
  </Stack>;

  const apiTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="DHL tracking API" description="Configure the tracking connection here instead of relying on source-code or deployment secrets." />
        <Box xcss={config.dhlApiKeyConfigured ? statusOkStyle : statusWarnStyle}>
          <Text>{config.dhlApiKeyConfigured ? "DHL tracking API key is configured securely." : "DHL tracking API key is not configured."}</Text>
        </Box>
        <FieldBlock label="DHL tracking API URL" help="For security, this build only permits HTTPS endpoints on api-eu.dhl.com.">
          <Textfield value={config.dhlApiUrl || ""} onChange={(e) => patch("dhlApiUrl", e.target.value)} />
        </FieldBlock>
        <FieldBlock label="DHL account number (optional)" help="Can be retained as a general account reference; shipment creation has its own account setting below.">
          <Textfield value={config.dhlAccountNumber || ""} onChange={(e) => patch("dhlAccountNumber", e.target.value)} />
        </FieldBlock>
        <FieldBlock label="DHL tracking API key" help={config.dhlApiKeyConfigured ? "A key is already stored. Enter a new value only when replacing it." : "Paste the DHL API key and save it securely."}>
          <Textfield type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.dhlApiKeyConfigured ? "••••••••••••••••" : "Enter DHL API key"} />
        </FieldBlock>
        <Inline space="space.100" shouldWrap>
          <Button appearance="primary" onClick={saveApiKey} isDisabled={busy || !apiKey}>Save tracking API key</Button>
          <Button onClick={testApi} isDisabled={busy || !config.dhlApiKeyConfigured}>Test tracking connection</Button>
          {config.dhlApiKeyConfigured ? <Button appearance="subtle" onClick={clearApiKey} isDisabled={busy}>Clear tracking API key</Button> : null}
        </Inline>
        {apiTest ? <Box xcss={apiTest.ok ? statusOkStyle : statusWarnStyle}><Text>{apiTest.message}</Text></Box> : null}
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="DHL Express shipment creation" description="Create DHL shipments directly from Hardware tickets and write the returned tracking number and label back to Jira." />
        <ToggleRow
          label="Enable DHL shipment creation"
          description="Keep this OFF until DHL test credentials, account and product configuration have passed validation."
          warning={config.dhlShippingEnvironment === "production" ? "Production mode can create real chargeable shipments." : "Test mode is recommended until end-to-end validation is complete."}
          checked={config.dhlShippingEnabled}
          onChange={(e) => patch("dhlShippingEnabled", e.target.checked)}
        />
        <Box xcss={config.dhlShippingCredentialsConfigured ? statusOkStyle : statusWarnStyle}>
          <Text>{config.dhlShippingCredentialsConfigured ? "DHL Express shipping credentials are configured securely." : "DHL Express shipping credentials are not configured."}</Text>
        </Box>
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}>
            <FieldBlock label="Environment" help="Use Test until shipment creation, labels and Jira write-back have been proven.">
              <Select
                options={[{ label: "Test", value: "test" }, { label: "Production", value: "production" }]}
                value={optionFor([{ label: "Test", value: "test" }, { label: "Production", value: "production" }], config.dhlShippingEnvironment)}
                onChange={(option) => {
                  const value = option?.value || "test";
                  patch("dhlShippingEnvironment", value);
                  patch("dhlShippingApiUrl", value === "production" ? "https://express.api.dhl.com/mydhlapi" : "https://express.api.dhl.com/mydhlapi/test");
                  if (value === "production") patch("dhlShippingEnabled", false);
                }}
              />
            </FieldBlock>
          </Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Shipping API URL"><Textfield value={config.dhlShippingApiUrl || ""} onChange={(e) => patch("dhlShippingApiUrl", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Shipping account number"><Textfield value={config.dhlShippingAccountNumber || ""} onChange={(e) => patch("dhlShippingAccountNumber", e.target.value)} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="DHL product code" help="The MyDHL product code used for shipment creation."><Textfield value={config.dhlProductCode || ""} onChange={(e) => patch("dhlProductCode", e.target.value)} /></FieldBlock></Box>
        </Inline>
        <ToggleRow label="Request pickup by default" description="Pre-select pickup on the Create DHL Shipment action. Agents can still change it before submitting." checked={config.dhlPickupRequestedByDefault} onChange={(e) => patch("dhlPickupRequestedByDefault", e.target.checked)} />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="DHL Express API username"><Textfield value={shippingUsername} onChange={(e) => setShippingUsername(e.target.value)} placeholder={config.dhlShippingCredentialsConfigured ? "Stored securely — enter only to replace" : "Enter MyDHL API username"} /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="DHL Express API password"><Textfield type="password" value={shippingPassword} onChange={(e) => setShippingPassword(e.target.value)} placeholder={config.dhlShippingCredentialsConfigured ? "••••••••••••••••" : "Enter MyDHL API password"} /></FieldBlock></Box>
        </Inline>
        <Inline space="space.100" shouldWrap>
          <Button appearance="primary" onClick={saveShippingCredentials} isDisabled={busy || !shippingUsername || !shippingPassword}>Save shipping credentials</Button>
          <Button onClick={testShippingApi} isDisabled={busy || !config.dhlShippingCredentialsConfigured}>Test shipping connection</Button>
          {config.dhlShippingCredentialsConfigured ? <Button appearance="subtle" onClick={clearShippingCredentials} isDisabled={busy}>Clear shipping credentials</Button> : null}
        </Inline>
        {shippingTest ? <Box xcss={shippingTest.ok ? statusOkStyle : statusWarnStyle}><Text>{shippingTest.message}</Text></Box> : null}
        {config.dhlShippingEnvironment === "production" ? <Box xcss={statusWarnStyle}><Text>Production mode selected. Shipment creation is forced OFF when switching to Production; re-enable it only after validation and a deliberate go-live decision.</Text></Box> : <Box xcss={infoStyle}><Text>Test mode selected. DHL shipment creation remains isolated from production until you deliberately switch environment and re-enable it.</Text></Box>}
      </Stack>
    </Box>

    <Box xcss={infoStyle}>
      <Stack space="space.075">
        <Heading as="h3">Credential security</Heading>
        <Text>Tracking and shipping credentials are stored separately in Forge encrypted secret storage. They are never returned to the browser after saving and are not kept in normal app configuration.</Text>
      </Stack>
    </Box>
  </Stack>;

  const mappingTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.250">
        <SectionHeader title="Core Jira fields" description="Choose every Jira field Delivery Manager reads or updates." />
        <Inline space="space.200" shouldWrap>
          {[
            ["Tracking Number", "trackingField", "DHL tracking/reference number."],
            ["Date Sent", "dateSentField", "Date the hardware was dispatched."],
            ["Delivery Status", "deliveryStatusField", "Latest delivery state."],
            ["Date Delivered", "deliveryDateField", "Date DHL confirms delivery."],
            ["Signed For", "signedForField", "Recipient/signature name where available."],
            ["Last DHL Check", "lastDhlCheckField", "Internal timestamp used for fair polling rotation; agents normally do not need to edit it."],
          ].map(([label, key, help]) => <Box xcss={fieldColumnStyle} key={key}><FieldBlock label={label} help={help}>{fieldSelect(key)}</FieldBlock></Box>)}
        </Inline>
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Additional SD → HW mappings" description="Choose extra Service Desk fields to copy when a Hardware ticket is created." />
        <Inline space="space.200" shouldWrap>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Service Desk source field"><Select options={fields} value={optionFor(fields, mappingSource)} onChange={(option) => setMappingSource(option?.value || "")} placeholder="Select source field" /></FieldBlock></Box>
          <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware target field"><Select options={fields} value={optionFor(fields, mappingTarget)} onChange={(option) => setMappingTarget(option?.value || "")} placeholder="Select target field" /></FieldBlock></Box>
        </Inline>
        <Box><Button appearance="primary" onClick={addMapping}>Add field mapping</Button></Box>
        {(config.hwFieldMappings || []).length === 0 ? <Box xcss={subSectionStyle}><Text>No additional field mappings configured.</Text></Box> : null}
        {(config.hwFieldMappings || []).map((mapping, index) => <Box xcss={mappingRowStyle} key={`${mapping.source}-${mapping.target}-${index}`}>
          <Inline spread="space-between" alignBlock="center" space="space.200">
            <Text>{labelForField(fields, mapping.source)} → {labelForField(fields, mapping.target)}</Text>
            <Button appearance="subtle" onClick={() => removeMapping(index)}>Remove</Button>
          </Inline>
        </Box>)}
      </Stack>
    </Box>
  </Stack>;

  const automationTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Safety & automation" description="Control exactly what Delivery Manager is allowed to do automatically." />
        <ToggleRow label="Add internal automated comments" description="Adds private Jira comments when Delivery Manager creates, repairs or updates a ticket so agents have an audit trail." checked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} />
        <ToggleRow label="Allow workflow transitions" description="Allows Delivery Manager to move Jira issues to the statuses configured in the other tabs." checked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} />
        <ToggleRow label="Automatically create missing HW tickets" description="Allows scheduled reconciliation to create a missing Hardware ticket when an SD request reaches the handover status." warning="Keep this OFF until the work-sandbox duplicate and end-to-end tests are complete." checked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} />
        {config.createEnabled ? <MessageBanner appearance="warning">Automatic Hardware creation is enabled. Validate the configuration and duplicate safeguards before leaving this enabled.</MessageBanner> : <Box xcss={infoStyle}><Text>Automatic Hardware creation is OFF — the recommended safe state during sandbox testing. Manual Create Hardware Ticket remains available.</Text></Box>}
      </Stack>
    </Box>
  </Stack>;

  const previewBlock = (title, data) => <Box xcss={subSectionStyle}>
    <Stack space="space.075">
      <Heading as="h3">{title}</Heading>
      <Text>{data?.ok ? `${data.count}${data.capped ? "+" : ""} issue(s) matched in the read-only preview.` : `Query failed: ${data?.error || "Unknown error"}`}</Text>
      {(data?.issues || []).map((issue) => <Text key={issue.key}>{issue.key} — {issue.status}{issue.summary ? ` — ${issue.summary}` : ""}</Text>)}
    </Stack>
  </Box>;

  const diagnosticsTab = <Stack space="space.250">
    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Runtime health" description="See the most recent scheduler execution and what each part of the app actually did." />
        <Inline space="space.100"><Button onClick={refreshHealth} isDisabled={busy}>Refresh runtime health</Button></Inline>
        {runtimeHealth?.lastRunCompletedAt ? <Box xcss={runtimeHealth.ok ? statusOkStyle : statusWarnStyle}>
          <Stack space="space.075">
            <Text>Last scheduler run: {runtimeHealth.lastRunCompletedAt}</Text>
            <Text>Overall result: {runtimeHealth.ok ? "Healthy" : "Needs attention"}</Text>
            <Text>Hardware: {runtimeHealth.hardware?.ok === false ? `Failed${runtimeHealth.hardware?.error ? ` — ${runtimeHealth.hardware.error}` : ""}` : `Checked ${runtimeHealth.hardware?.dispatch?.checked ?? 0}, repaired ${runtimeHealth.hardware?.dispatch?.repaired ?? 0}, created ${runtimeHealth.hardware?.creation?.created ?? 0}, duplicate skips ${runtimeHealth.hardware?.creation?.skippedDuplicates ?? 0}`}</Text>
            <Text>DHL: {runtimeHealth.dhl?.skipped ? `Skipped — ${runtimeHealth.dhl?.reason || "not due"}` : `Eligible ${runtimeHealth.dhl?.eligible ?? 0}, processed ${runtimeHealth.dhl?.processed ?? 0}, updated ${runtimeHealth.dhl?.updated ?? 0}, delivered ${runtimeHealth.dhl?.delivered ?? 0}, failed requests ${runtimeHealth.dhl?.failedRequests ?? 0}${runtimeHealth.dhl?.rateLimited ? ", rate limited" : ""}`}</Text>
          </Stack>
        </Box> : <Box xcss={infoStyle}><Text>No scheduler health record exists yet. The first scheduled run after this build is deployed will populate it.</Text></Box>}
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Configuration validation" description="Check projects, statuses, issue/link types, fields, DHL tracking and shipping credentials, and automation safeguards." />
        <Inline space="space.100" shouldWrap>
          <Button appearance="primary" onClick={validate} isDisabled={busy}>Run validation</Button>
          <Button onClick={runPreview} isDisabled={busy}>Run read-only preview</Button>
          <Button onClick={save} isDisabled={busy}>Save settings</Button>
        </Inline>
        {validation?.checks?.length ? <Box xcss={subSectionStyle}>
          <Stack space="space.075">
            <Heading as="h3">Validation results</Heading>
            {validation.checks.map((check) => <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.key}: {check.message}</Text>)}
          </Stack>
        </Box> : <Text>No validation run yet in this session.</Text>}
      </Stack>
    </Box>

    <Box xcss={sectionStyle}>
      <Stack space="space.200">
        <SectionHeader title="Operational preview" description="See what the current configuration would target without creating, updating or transitioning any issues." />
        {preview ? <>
          <Box xcss={preview.ok ? statusOkStyle : statusWarnStyle}>
            <Text>Preview generated {preview.generatedAt}. HW auto-create: {preview.autoCreateEnabled ? "ON" : "OFF"}; workflow transitions: {preview.transitionsEnabled ? "ON" : "OFF"}; DHL tracking API key: {preview.dhlApiKeyConfigured ? "configured" : "not configured"}; DHL shipment creation: {preview.dhlShippingEnabled ? `${preview.dhlShippingEnvironment} / ${preview.dhlShippingCredentialsConfigured ? "credentials configured" : "credentials missing"}` : "OFF"}.</Text>
          </Box>
          {previewBlock("SD requests at handover status", preview.handover)}
          {previewBlock("HW tickets at dispatched status", preview.dispatchedHardware)}
          {previewBlock("DHL polling candidates", preview.dhlEligible)}
        </> : <Text>Run the read-only preview to inspect current candidate issues safely.</Text>}
      </Stack>
    </Box>
  </Stack>;

  const content = activeTab === "hardware" ? hardwareTab
    : activeTab === "tracking" ? trackingTab
      : activeTab === "api" ? apiTab
        : activeTab === "mapping" ? mappingTab
          : activeTab === "automation" ? automationTab
            : activeTab === "diagnostics" ? diagnosticsTab
              : generalTab;

  return <Box xcss={pageStyle}>
    <Stack space="space.250">
      <Box xcss={heroStyle}>
        <Inline spread="space-between" alignBlock="center" space="space.250" shouldWrap>
          <Stack space="space.075">
            <Heading as="h1">Delivery Manager</Heading>
            <Text>Hardware handover, DHL shipment creation, dispatch, tracking and delivery resolution.</Text>
            <Text>UI build: {UI_BUILD}</Text>
          </Stack>
          <Inline space="space.100" shouldWrap>
            <Button onClick={validate} isDisabled={busy}>Validate settings</Button>
            <Button appearance="primary" onClick={save} isDisabled={busy}>Save changes</Button>
          </Inline>
        </Inline>
      </Box>

      {message ? <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner> : null}

      <Box xcss={tabsStyle}>
        <Inline space="space.050" shouldWrap>
          {TABS.map((tab) => <Button key={tab.id} appearance={activeTab === tab.id ? "primary" : "subtle"} onClick={() => setActiveTab(tab.id)}>{tab.label}</Button>)}
        </Inline>
      </Box>

      {content}
    </Stack>
  </Box>;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
