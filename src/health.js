import { kvs } from "@forge/kvs";

export const HEALTH_KEY = "delivery-manager-health-v1";

export async function getDeliveryManagerHealth() {
  return (await kvs.get(HEALTH_KEY)) || {
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    ok: null,
    hardware: null,
    dhl: null,
  };
}

export async function saveDeliveryManagerHealth(health) {
  const clean = {
    lastRunStartedAt: health?.lastRunStartedAt || null,
    lastRunCompletedAt: health?.lastRunCompletedAt || null,
    ok: typeof health?.ok === "boolean" ? health.ok : null,
    hardware: health?.hardware || null,
    dhl: health?.dhl || null,
  };
  await kvs.set(HEALTH_KEY, clean);
  return clean;
}
