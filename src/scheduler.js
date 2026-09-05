import { runConfiguredDhl as runDhl } from "./dhl-runtime.js";
import { runHardwareSync } from "./hardware-sync.js";
import { shouldRunDhl } from "./scheduler-core.mjs";
import { saveDeliveryManagerHealth } from "./health.js";

export async function runCombinedScheduler() {
  const lastRunStartedAt = new Date().toISOString();
  console.log("🔄 Combined Delivery Manager scheduler starting");

  let hardware = null;
  let dhl = { ok: true, skipped: true, reason: "not-due" };

  try {
    hardware = await runHardwareSync();
  } catch (error) {
    hardware = { ok: false, error: String(error) };
    console.log(`❌ Hardware reconciliation failed: ${String(error)}`);
  }

  if (!shouldRunDhl()) {
    console.log("⏭️ DHL polling skipped on this five-minute cycle");
  } else {
    console.log("📦 15-minute DHL polling cycle due");
    try {
      dhl = await runDhl();
    } catch (error) {
      dhl = { ok: false, skipped: false, error: String(error) };
      console.log(`❌ DHL polling failed: ${String(error)}`);
    }
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
