import { runConfiguredDhl as runDhl } from "./dhl-runtime.js";
import { runHardwareSync } from "./hardware-sync.js";
import { shouldRunDhl } from "./scheduler-core.mjs";

export async function runCombinedScheduler() {
  console.log("🔄 Combined Delivery Manager scheduler starting");

  try {
    await runHardwareSync();
  } catch (error) {
    console.log(`❌ Hardware reconciliation failed: ${String(error)}`);
  }

  if (!shouldRunDhl()) {
    console.log("⏭️ DHL polling skipped on this five-minute cycle");
    return;
  }

  console.log("📦 15-minute DHL polling cycle due");

  try {
    await runDhl();
  } catch (error) {
    console.log(`❌ DHL polling failed: ${String(error)}`);
  }
}
