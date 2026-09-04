import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Heading, Inline, Label, MessageBanner, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import { invoke } from "@forge/bridge";

const UI_BUILD = "DM-COMBINED-RC-20260904-UI1";

const pageStyle = xcss({ maxWidth: "1200px" });
const heroStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "color.background.neutral.subtle" });
const sectionStyle = xcss({ padding: "space.300", borderRadius: "border.radius.300", backgroundColor: "elevation.surface", borderWidth: "border.width", borderStyle: "solid", borderColor: "color.border" });
const subSectionStyle = xcss({ padding: "space.200", borderRadius: "border.radius.200", backgroundColor: "color.background.neutral.subtle" });
const fieldColumnStyle = xcss({ width: "49%", minWidth: "320px" });
const statusOkStyle = xcss({ padding: "space.150", borderRadius: "border.radius.200", backgroundColor: "color.background.success" });
const statusWarnStyle = xcss({ padding: "space.150", borderRadius: "border.radius.200", backgroundColor: "color.background.warning" });
const footerStyle = xcss({ paddingBlock: "space.200" });

const FALLBACK_CONFIG = {
  sdProject: "SD", hwProject: "HW", sdSentStatus: "Sent to Hardware", hwDispatchedStatus: "Dispatched", sdDispatchedStatus: "Dispatched",
  outForDeliveryStatus: "OUT FOR DELIVERY", awaitingCollectionStatus: "DELIVERY AWAITING COLLECTION", onHoldStatus: "DELIVERY ON HOLD", failedStatus: "DELIVERY FAILED", resolvedStatus: "Resolved",
  trackingField: "customfield_10417", dateSentField: "customfield_10433", deliveryStatusField: "customfield_11952", deliveryDateField: "customfield_10434", signedForField: "customfield_10442", lastDhlCheckField: "customfield_14400",
  clientField: "", clientRestrictionEnabled: false, clientValues: [], hwIssueType: "", hwLinkType: "Relates", hwFieldMappings: [], commentsEnabled: true, transitionsEnabled: true, createEnabled: false,
  maxResults: 100, dhlBatchSize: 10, dhlDelayMs: 3000, minDaysSinceSent: 3,
};

const optionFor = (options, value) => options.find((item) => item.value === value) || (value ? { label: value, value } : null);
const labelForField = (fields, value) => fields.find((item) => item.value === value)?.label || value || "Unknown field";
const withTimeout = (promise, label, timeoutMs = 12000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs))]);
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
    setMessage({ appearance: "success", text: "Field mapping added. Save settings when you are ready." });
  };

  const removeMapping = (index) => patch("hwFieldMappings", (config.hwFieldMappings || []).filter((_, itemIndex) => itemIndex !== index));

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

  const allConnectionsHealthy = looksHealthy(configStatus) && looksHealthy(optionsStatus) && looksHealthy(statusStatus);

  return <Box xcss={pageStyle}>
    <Stack space="space.300">
      <Box xcss={heroStyle}>
        <Stack space="space.150">
          <Heading as="h1">Delivery Manager</Heading>
          <Text>Configure hardware handover, dispatch, DHL tracking and delivery resolution from one place.</Text>
          <Inline space="space.100" shouldWrap>
            <Button appearance="primary" onClick={save} isDisabled={busy}>Save settings</Button>
            <Button onClick={validate} isDisabled={busy}>Validate configuration</Button>
          </Inline>
        </Stack>
      </Box>

      {message && <MessageBanner appearance={message.appearance}>{message.text}</MessageBanner>}

      <Box xcss={allConnectionsHealthy ? statusOkStyle : statusWarnStyle}>
        <Stack space="space.075">
          <Heading as="h3">{allConnectionsHealthy ? "✓ Jira connection ready" : "Jira connection status"}</Heading>
          <Text>{configStatus}</Text>
          <Text>{optionsStatus}</Text>
          <Text>{statusStatus}</Text>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="1. Projects & hardware workflow" description="Choose the two projects and the statuses that control the hardware handover." />
          <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="Service project">{projectSelect("sdProject")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware project">{projectSelect("hwProject")}</FieldBlock></Box>
          </Inline>
          <Box xcss={subSectionStyle}>
            <Stack space="space.200">
              <Heading as="h3">Workflow statuses</Heading>
              <Inline space="space.200" shouldWrap alignBlock="start">
                <Box xcss={fieldColumnStyle}><FieldBlock label="Send to Hardware trigger">{statusSelect("sdSentStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
                <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware dispatched">{statusSelect("hwDispatchedStatus", hwStatuses, "No HW statuses loaded")}</FieldBlock></Box>
                <Box xcss={fieldColumnStyle}><FieldBlock label="Service Desk dispatched">{statusSelect("sdDispatchedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
              </Inline>
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="2. DHL delivery workflow" description="Map DHL delivery events to your Service Desk workflow statuses." />
          <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="Out for Delivery">{statusSelect("outForDeliveryStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Awaiting Collection">{statusSelect("awaitingCollectionStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="On Hold">{statusSelect("onHoldStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Failed">{statusSelect("failedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Final Resolved status">{statusSelect("resolvedStatus", sdStatuses, "No SD statuses loaded")}</FieldBlock></Box>
          </Inline>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="3. Jira fields" description="Select the Jira fields Delivery Manager should read and update. Field names are shown here while stable IDs are stored in the configuration." />
          <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="Tracking Number">{fieldSelect("trackingField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Date Sent">{fieldSelect("dateSentField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Delivery Status">{fieldSelect("deliveryStatusField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Date Delivered">{fieldSelect("deliveryDateField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Signed For">{fieldSelect("signedForField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Last DHL Check">{fieldSelect("lastDhlCheckField")}</FieldBlock></Box>
          </Inline>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="4. Hardware ticket creation" description="Control what gets copied to HW and keep duplicate protection in place." />
          <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="HW issue type"><Textfield value={config.hwIssueType} onChange={(e) => patch("hwIssueType", e.target.value)} placeholder="For example Task or Hardware Request" /></FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Issue link type"><Textfield value={config.hwLinkType} onChange={(e) => patch("hwLinkType", e.target.value)} /></FieldBlock></Box>
          </Inline>

          <Box xcss={subSectionStyle}>
            <Stack space="space.150">
              <Heading as="h3">Additional SD → HW field mappings</Heading>
              <Text>Add only the extra fields you want copied when a Hardware ticket is created.</Text>
              <Inline space="space.200" shouldWrap alignBlock="end">
                <Box xcss={fieldColumnStyle}><FieldBlock label="Service Desk source field"><Select options={fields} value={optionFor(fields, mappingSource)} onChange={(option) => setMappingSource(option?.value || "")} placeholder="Select source field" /></FieldBlock></Box>
                <Box xcss={fieldColumnStyle}><FieldBlock label="Hardware target field"><Select options={fields} value={optionFor(fields, mappingTarget)} onChange={(option) => setMappingTarget(option?.value || "")} placeholder="Select target field" /></FieldBlock></Box>
              </Inline>
              <Box><Button onClick={addMapping}>Add field mapping</Button></Box>
              {(config.hwFieldMappings || []).length === 0 ? <Text>No additional field mappings configured.</Text> : null}
              {(config.hwFieldMappings || []).map((mapping, index) => <Inline key={`${mapping.source}-${mapping.target}-${index}`} spread="space-between" alignBlock="center">
                <Text>{labelForField(fields, mapping.source)} → {labelForField(fields, mapping.target)}</Text>
                <Button appearance="subtle" onClick={() => removeMapping(index)}>Remove</Button>
              </Inline>)}
            </Stack>
          </Box>

          <Box xcss={subSectionStyle}>
            <Stack space="space.150">
              <Heading as="h3">Safety & automation</Heading>
              <Text>Manual creation checks existing links and recorded creations before creating a Hardware ticket, then checks again on the server.</Text>
              <Toggle isChecked={config.commentsEnabled} onChange={(e) => patch("commentsEnabled", e.target.checked)} label="Add internal automated comments" />
              <Toggle isChecked={config.transitionsEnabled} onChange={(e) => patch("transitionsEnabled", e.target.checked)} label="Allow workflow transitions" />
              <Toggle isChecked={config.createEnabled} onChange={(e) => patch("createEnabled", e.target.checked)} label="Automatically create missing HW tickets" />
              {config.createEnabled && <MessageBanner appearance="warning">Keep this OFF until manual creation and duplicate-protection tests have passed in the sandbox.</MessageBanner>}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="5. Client restrictions" description="Optionally limit DHL tracking to selected client values." />
          <Toggle isChecked={config.clientRestrictionEnabled} onChange={(e) => patch("clientRestrictionEnabled", e.target.checked)} label="Restrict tracking to selected clients" />
          {config.clientRestrictionEnabled && <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="Client field">{fieldSelect("clientField")}</FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Allowed client values"><Textfield value={(config.clientValues || []).join(", ")} onChange={(e) => patch("clientValues", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} placeholder="RYR, RYS, LDA" /></FieldBlock></Box>
          </Inline>}
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.250">
          <SectionHeader title="6. DHL polling" description="Fine-tune when and how many shipments are checked. Hardware reconciliation still runs every 5 minutes." />
          <Inline space="space.200" shouldWrap alignBlock="start">
            <Box xcss={fieldColumnStyle}><FieldBlock label="Minimum days since Date Sent"><Textfield type="number" value={String(config.minDaysSinceSent)} onChange={(e) => patch("minDaysSinceSent", Number(e.target.value))} /></FieldBlock></Box>
            <Box xcss={fieldColumnStyle}><FieldBlock label="Maximum DHL checks per cycle"><Textfield type="number" value={String(config.dhlBatchSize)} onChange={(e) => patch("dhlBatchSize", Number(e.target.value))} /></FieldBlock></Box>
          </Inline>
          <Text>DHL polling runs approximately every 15 minutes.</Text>
        </Stack>
      </Box>

      <Box xcss={sectionStyle}>
        <Stack space="space.200">
          <SectionHeader title="7. Validate & save" description="Run validation before sandbox testing. It checks projects, statuses, fields, mappings, client restrictions and HW auto-creation safety." />
          <Inline space="space.100" shouldWrap>
            <Button appearance="primary" onClick={validate} isDisabled={busy}>Validate configuration</Button>
            <Button onClick={save} isDisabled={busy}>Save settings</Button>
          </Inline>
          {validation?.checks?.map((check) => <Text key={check.key}>{check.ok ? "✓" : "✗"} {check.message}</Text>)}
        </Stack>
      </Box>

      <Box xcss={footerStyle}><Text>Delivery Manager · UI build {UI_BUILD}</Text></Box>
    </Stack>
  </Box>;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
