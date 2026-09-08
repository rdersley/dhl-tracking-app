import { runConfiguredDhl as runDhl } from "./dhl-runtime.js";
import { runHardwareSync } from "./hardware-sync.js";
import { shouldRunDhl } from "./scheduler-core.mjs";
import { getDeliveryManagerConfig } from "./config.js";
import { saveDeliveryManagerHealth } from "./health.js";

export async function runCombinedScheduler() {
  const lastRunStartedAt = new Date().toISOString();

  // Forge invokes this trigger every five minutes. Hardware reconciliation is a
  // safety-net rather than the primary handover mechanism, so running the full
  // combined cycle every 15 minutes is sufficient and avoids two out of every
  // three scheduled KVS config reads.
  if (!shouldRunDhl()) {
    console.log("⏭️ Delivery Manager full cycle not due; skipping without reading KVS");
    return {
      lastRunStartedAt,
      lastRunCompletedAt: new Date().toISOString(),
      ok: true,
      skipped: true,
      reason: "not-due",
      hardware: { ok: true, skipped: true, reason: "not-due" },
      dhl: { ok: true, skipped: true, reason: "not-due" },
    };
  }

  console.log("🔄 Combined Delivery Manager 15-minute cycle starting");

  let config;
  try {
    // Read the configuration once per combined cycle and share it with both
    // hardware reconciliation and DHL tracking instead of reading it twice.
    config = await getDeliveryManagerConfig();
  } catch (error) {
    const health = {
      lastRunStartedAt,
      lastRunCompletedAt: new Date().toISOString(),
      ok: false,
      hardware: { ok: false, skipped: true, reason: "config-read-failed" },
      dhl: { ok: false, skipped: true, reason: "config-read-failed" },
      error: String(error),
    };
    console.log(`❌ Delivery Manager config read failed: ${String(error)}`);
    return health;
  }

  let hardware = null;
  let dhl = null;

  try {
    hardware = await runHardwareSync(config);
  } catch (error) {
    hardware = { ok: false, error: String(error) };
    console.log(`❌ Hardware reconciliation failed: ${String(error)}`);
  }

  try {
    dhl = await runDhl(config);
  } catch (error) {
    dhl = { ok: false, skipped: false, error: String(error) };
    console.log(`❌ DHL polling failed: ${String(error)}`);
  }

  const health = {
    lastRunStartedAt,
    lastRunCompletedAt: new Date().toISOString(),
    ok: hardware?.ok !== false && dhl?.ok !== false,
    hardware,
    dhl,
  };

  try {
    await saveDeliveryManagerHealth(health);
  } catch (error) {
    console.log(`⚠️ Could not persist Delivery Manager health status: ${String(error)}`);
  }

  return health;
}
