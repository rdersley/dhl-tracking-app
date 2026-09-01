import React, { useEffect, useMemo, useState } from "react";
import ForgeReconciler, {
  Button,
  ButtonGroup,
  Heading,
  Link,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  useProductContext,
} from "@forge/react";
import { invoke, view } from "@forge/bridge";

function App() {
  const context = useProductContext();
  const issueKey = useMemo(
    () => context?.extension?.issue?.key || context?.platformContext?.issueKey || "",
    [context]
  );
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function check() {
    if (!issueKey) return;
    setBusy(true);
    setResult(null);
    try {
      setState(await invoke("checkHardwareTicket", { issueKey }));
    } catch (error) {
      setState({ ok: false, error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    check();
  }, [issueKey]);

  async function create(force = false) {
    setBusy(true);
    setResult(null);
    try {
      const response = await invoke("createHardwareTicket", { issueKey, force });
      setResult(response);
      if (response?.ok) {
        setState((current) => ({
          ...(current || {}),
          duplicate: true,
          existingKeys: [...new Set([...(current?.existingKeys || []), response.hardwareKey])],
        }));
      } else if (response?.duplicate) {
        setState((current) => ({
          ...(current || {}),
          duplicate: true,
          existingKeys: response.existingKeys || current?.existingKeys || [],
        }));
      }
    } catch (error) {
      setResult({ ok: false, error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!context || (busy && !state)) return <Spinner size="large" />;

  if (!issueKey) {
    return (
      <SectionMessage appearance="error" title="Issue unavailable">
        <Text>Delivery Manager could not determine the current Jira issue.</Text>
      </SectionMessage>
    );
  }

  if (state && !state.ok) {
    return (
      <Stack space="space.200">
        <Heading as="h3">Create Hardware Ticket</Heading>
        <SectionMessage appearance="warning" title="Cannot create hardware ticket">
          <Text>{state.error || "The hardware ticket configuration is not ready."}</Text>
        </SectionMessage>
        <ButtonGroup>
          <Button onClick={check} isDisabled={busy}>Check again</Button>
          <Button onClick={() => view.close()} appearance="subtle">Close</Button>
        </ButtonGroup>
      </Stack>
    );
  }

  const existing = state?.existingKeys || [];
  const hasExisting = state?.duplicate === true && existing.length > 0;

  return (
    <Stack space="space.200">
      <Heading as="h3">Create Hardware Ticket</Heading>
      <Text>Service request: {issueKey}</Text>

      {hasExisting ? (
        <SectionMessage appearance="warning" title="Hardware ticket already exists">
          <Text>
            This request is already associated with {existing.length === 1 ? "a hardware ticket" : "hardware tickets"}: {existing.join(", ")}.
          </Text>
          <Text>Creating another ticket can cause duplicate hardware work. Cancel is the safe default.</Text>
        </SectionMessage>
      ) : (
        <SectionMessage appearance="information" title="No existing hardware ticket found">
          <Text>Delivery Manager checked the current Jira links and its creation record. It will check again on the server immediately before creating the ticket.</Text>
        </SectionMessage>
      )}

      {result && (
        <SectionMessage
          appearance={result.ok ? "success" : result.linkFailed ? "warning" : "error"}
          title={result.ok ? "Hardware ticket created" : result.linkFailed ? "Ticket created but link needs attention" : "Hardware ticket not created"}
        >
          <Text>{result.ok ? `${result.hardwareKey} was created and linked successfully.` : result.error}</Text>
          {result?.hardwareKey && <Link href={`/browse/${result.hardwareKey}`}>Open {result.hardwareKey}</Link>}
        </SectionMessage>
      )}

      {existing.length > 0 && (
        <Stack space="space.050">
          {existing.map((key) => (
            <Link key={key} href={`/browse/${key}`}>Open {key}</Link>
          ))}
        </Stack>
      )}

      <ButtonGroup>
        {!hasExisting && !result?.ok && (
          <Button appearance="primary" onClick={() => create(false)} isDisabled={busy}>
            {busy ? "Creating…" : "Create Hardware Ticket"}
          </Button>
        )}
        {hasExisting && !result?.ok && (
          <Button appearance="danger" onClick={() => create(true)} isDisabled={busy}>
            {busy ? "Checking…" : "Create another anyway"}
          </Button>
        )}
        <Button onClick={() => view.close()} appearance={hasExisting ? "primary" : "subtle"}>
          {hasExisting ? "Cancel" : "Close"}
        </Button>
      </ButtonGroup>
    </Stack>
  );
}

ForgeReconciler.render(<App />);
