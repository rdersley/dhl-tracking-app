import React, { useEffect, useMemo, useState } from "react";
import ForgeReconciler, {
  Button,
  ButtonGroup,
  Checkbox,
  Heading,
  Label,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  useProductContext,
} from "@forge/react";
import { invoke, view } from "@forge/bridge";

const emptyParty = { name: "", company: "", address1: "", address2: "", city: "", county: "", postalCode: "", countryCode: "IE", phone: "", email: "" };

function App() {
  const context = useProductContext();
  const issueKey = useMemo(() => context?.extension?.issue?.key || context?.platformContext?.issueKey || "", [context]);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [draft, setDraft] = useState({
    reference: "",
    shipper: { ...emptyParty },
    receiver: { ...emptyParty },
    package: { weightKg: "1", lengthCm: "30", widthCm: "20", heightCm: "10", description: "Hardware" },
    contentsDescription: "Hardware",
    pickupRequested: false,
    isCustomsDeclarable: false,
  });

  function patchParty(which, field, value) {
    setDraft((current) => ({ ...current, [which]: { ...current[which], [field]: value } }));
  }

  function patchPackage(field, value) {
    setDraft((current) => ({ ...current, package: { ...current.package, [field]: value } }));
  }

  async function check() {
    if (!issueKey) return;
    setBusy(true);
    setResult(null);
    setConfirmProduction(false);
    try {
      const response = await invoke("checkDhlShipment", { issueKey });
      setState(response);
      if (response?.ok) {
        setDraft((current) => ({
          ...current,
          reference: current.reference || issueKey,
          pickupRequested: response.pickupRequestedByDefault === true,
        }));
      }
    } catch (error) {
      setState({ ok: false, error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { check(); }, [issueKey]);

  async function createShipment() {
    setBusy(true);
    setResult(null);
    try {
      const response = await invoke("createDhlShipment", { issueKey, draft, confirmProduction });
      setResult(response);
      if (response?.created && response?.trackingNumber) {
        setState((current) => ({ ...(current || {}), existingTracking: response.trackingNumber, shipmentRecorded: true }));
      }
    } catch (error) {
      setResult({ ok: false, error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!context || (busy && !state)) return <Spinner size="large" />;
  if (!issueKey) return <SectionMessage appearance="error" title="Issue unavailable"><Text>Delivery Manager could not determine the current Jira issue.</Text></SectionMessage>;

  if (state && !state.ok) {
    return (
      <Stack space="space.200">
        <Heading as="h3">Create DHL Shipment</Heading>
        <SectionMessage appearance="warning" title="Shipment creation unavailable"><Text>{state.error || "Shipment configuration is not ready."}</Text></SectionMessage>
        <ButtonGroup><Button onClick={check} isDisabled={busy}>Check again</Button><Button onClick={() => view.close()} appearance="subtle">Close</Button></ButtonGroup>
      </Stack>
    );
  }

  const existing = state?.existingTracking;
  const isProduction = state?.shippingEnvironment === "production";
  const ready = state?.shippingEnabled && state?.credentialsConfigured && state?.accountConfigured && state?.productConfigured && !existing && (!isProduction || confirmProduction);

  return (
    <Stack space="space.200">
      <Heading as="h3">Create DHL Shipment</Heading>
      <Text>Hardware ticket: {issueKey}</Text>
      <Text>Environment: {isProduction ? "Production" : "DHL test"}</Text>

      {existing && (
        <SectionMessage appearance="warning" title="Shipment already exists">
          <Text>Tracking number {existing} is already recorded. Delivery Manager will not create another DHL shipment for this ticket.</Text>
        </SectionMessage>
      )}

      {!state?.shippingEnabled && <SectionMessage appearance="information" title="Shipment creation disabled"><Text>Enable DHL shipment creation in Delivery Manager settings after test credentials are configured.</Text></SectionMessage>}
      {!state?.credentialsConfigured && <SectionMessage appearance="warning" title="DHL credentials missing"><Text>Configure DHL Express shipping credentials in Delivery Manager settings.</Text></SectionMessage>}
      {!state?.accountConfigured && <SectionMessage appearance="warning" title="DHL account missing"><Text>Configure the DHL shipping account number.</Text></SectionMessage>}
      {!state?.productConfigured && <SectionMessage appearance="warning" title="DHL product missing"><Text>Configure a DHL product code before creating shipments.</Text></SectionMessage>}
      {isProduction && !existing && (
        <SectionMessage appearance="warning" title="Live DHL shipment">
          <Text>This will create a real shipment on the configured DHL Express account. Review the sender, recipient and package details before continuing.</Text>
        </SectionMessage>
      )}

      {!existing && (
        <Stack space="space.150">
          <Heading as="h4">Shipment</Heading>
          <Label labelFor="reference">Reference</Label><Textfield id="reference" value={draft.reference} onChange={(e) => setDraft((c) => ({ ...c, reference: e.target.value }))} />

          <Heading as="h4">Sender</Heading>
          <Label labelFor="s-name">Name</Label><Textfield id="s-name" value={draft.shipper.name} onChange={(e) => patchParty("shipper", "name", e.target.value)} />
          <Label labelFor="s-company">Company</Label><Textfield id="s-company" value={draft.shipper.company} onChange={(e) => patchParty("shipper", "company", e.target.value)} />
          <Label labelFor="s-address1">Address</Label><Textfield id="s-address1" value={draft.shipper.address1} onChange={(e) => patchParty("shipper", "address1", e.target.value)} />
          <Label labelFor="s-address2">Address line 2</Label><Textfield id="s-address2" value={draft.shipper.address2} onChange={(e) => patchParty("shipper", "address2", e.target.value)} />
          <Label labelFor="s-city">City</Label><Textfield id="s-city" value={draft.shipper.city} onChange={(e) => patchParty("shipper", "city", e.target.value)} />
          <Label labelFor="s-county">County/region</Label><Textfield id="s-county" value={draft.shipper.county} onChange={(e) => patchParty("shipper", "county", e.target.value)} />
          <Label labelFor="s-post">Postal code</Label><Textfield id="s-post" value={draft.shipper.postalCode} onChange={(e) => patchParty("shipper", "postalCode", e.target.value)} />
          <Label labelFor="s-country">Country code</Label><Textfield id="s-country" value={draft.shipper.countryCode} onChange={(e) => patchParty("shipper", "countryCode", e.target.value)} />
          <Label labelFor="s-phone">Phone</Label><Textfield id="s-phone" value={draft.shipper.phone} onChange={(e) => patchParty("shipper", "phone", e.target.value)} />
          <Label labelFor="s-email">Email</Label><Textfield id="s-email" value={draft.shipper.email} onChange={(e) => patchParty("shipper", "email", e.target.value)} />

          <Heading as="h4">Recipient</Heading>
          <Label labelFor="r-name">Name</Label><Textfield id="r-name" value={draft.receiver.name} onChange={(e) => patchParty("receiver", "name", e.target.value)} />
          <Label labelFor="r-company">Company</Label><Textfield id="r-company" value={draft.receiver.company} onChange={(e) => patchParty("receiver", "company", e.target.value)} />
          <Label labelFor="r-address1">Address</Label><Textfield id="r-address1" value={draft.receiver.address1} onChange={(e) => patchParty("receiver", "address1", e.target.value)} />
          <Label labelFor="r-address2">Address line 2</Label><Textfield id="r-address2" value={draft.receiver.address2} onChange={(e) => patchParty("receiver", "address2", e.target.value)} />
          <Label labelFor="r-city">City</Label><Textfield id="r-city" value={draft.receiver.city} onChange={(e) => patchParty("receiver", "city", e.target.value)} />
          <Label labelFor="r-county">County/region</Label><Textfield id="r-county" value={draft.receiver.county} onChange={(e) => patchParty("receiver", "county", e.target.value)} />
          <Label labelFor="r-post">Postal code</Label><Textfield id="r-post" value={draft.receiver.postalCode} onChange={(e) => patchParty("receiver", "postalCode", e.target.value)} />
          <Label labelFor="r-country">Country code</Label><Textfield id="r-country" value={draft.receiver.countryCode} onChange={(e) => patchParty("receiver", "countryCode", e.target.value)} />
          <Label labelFor="r-phone">Phone</Label><Textfield id="r-phone" value={draft.receiver.phone} onChange={(e) => patchParty("receiver", "phone", e.target.value)} />
          <Label labelFor="r-email">Email</Label><Textfield id="r-email" value={draft.receiver.email} onChange={(e) => patchParty("receiver", "email", e.target.value)} />

          <Heading as="h4">Package</Heading>
          <Label labelFor="weight">Weight (kg)</Label><Textfield id="weight" value={draft.package.weightKg} onChange={(e) => patchPackage("weightKg", e.target.value)} />
          <Label labelFor="length">Length (cm)</Label><Textfield id="length" value={draft.package.lengthCm} onChange={(e) => patchPackage("lengthCm", e.target.value)} />
          <Label labelFor="width">Width (cm)</Label><Textfield id="width" value={draft.package.widthCm} onChange={(e) => patchPackage("widthCm", e.target.value)} />
          <Label labelFor="height">Height (cm)</Label><Textfield id="height" value={draft.package.heightCm} onChange={(e) => patchPackage("heightCm", e.target.value)} />
          <Label labelFor="description">Description</Label><Textfield id="description" value={draft.package.description} onChange={(e) => patchPackage("description", e.target.value)} />
          <Checkbox label="Request DHL pickup" isChecked={draft.pickupRequested} onChange={(e) => setDraft((c) => ({ ...c, pickupRequested: e.target.checked }))} />
          <Checkbox label="Customs declaration required" isChecked={draft.isCustomsDeclarable} onChange={(e) => setDraft((c) => ({ ...c, isCustomsDeclarable: e.target.checked }))} />
          {isProduction && <Checkbox label="I confirm these details are correct and I want to create a LIVE DHL shipment" isChecked={confirmProduction} onChange={(e) => setConfirmProduction(e.target.checked)} />}
        </Stack>
      )}

      {result && (
        <SectionMessage appearance={result.ok ? "success" : result.created ? "warning" : "error"} title={result.ok ? "DHL shipment created" : result.created ? "Shipment created — Jira needs attention" : "Shipment not created"}>
          {result.trackingNumber && <Text>Tracking number: {result.trackingNumber}</Text>}
          {result.dispatchConfirmationNumber && <Text>Dispatch confirmation: {result.dispatchConfirmationNumber}</Text>}
          {result.labelAttached && <Text>DHL shipping label was attached to the hardware ticket.</Text>}
          {result.labelError && <Text>Label attachment warning: {result.labelError}</Text>}
          {result.error && <Text>{result.error}</Text>}
          {Array.isArray(result.errors) && result.errors.map((error) => <Text key={error}>{error}</Text>)}
        </SectionMessage>
      )}

      <ButtonGroup>
        {!existing && <Button appearance="primary" onClick={createShipment} isDisabled={busy || !ready}>{busy ? "Creating…" : isProduction ? "Create LIVE DHL Shipment" : "Create DHL Test Shipment"}</Button>}
        <Button onClick={() => view.close()} appearance="subtle">Close</Button>
      </ButtonGroup>
    </Stack>
  );
}

ForgeReconciler.render(<App />);
