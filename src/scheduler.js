import { runConfiguredDhl as runDhl } from "./dhl-runtime.js";
import { runHardwareSync } from "./hardware-sync.js";
import { shouldRunDhl } from "./scheduler-core.mjs";
import { getDeliveryManagerConfig } from "./config.js";
import { saveDeliveryManagerHealth } from "./health.js";
import { schedulerLicenceState } from "./access.js";

export async function runCombinedScheduler(event = {}, context = {}) {
  const lastRunStartedAt = new Date().toISOString();

  // Paid app: production installs without an active Marketplace licence do no
  // scheduled work (fail closed). Development/staging always run.
  const licence = schedulerLicenceState(context?.license ? context : event?.context || {});
  if (licence.enforced && !licence.active) {
    console.log("Delivery Manager: Marketplace licence inactive; scheduled cycle skipped");
    return {
      lastRunStartedAt,
      lastRunCompletedAt: new Date().toISOString(),
      ok: false,
      skipped: true,
      reason: "licence-inactive",
      hardware: { ok: false, skipped: true, reason: "licence-inactive" },
      dhl: { ok: false, skipped: true, reason: "licence-inactive" },
    };
  }

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
