// Which parts of the scheduled cycle are switched on. Both default to ON so
// existing installs keep their current behaviour; a shipping-only install
// turns both off and the scheduler then touches no Jira tickets.
export function schedulerPlan(config = {}) {
  return {
    hardware: config.hwReconciliationEnabled !== false,
    dhl: config.dhlTrackingEnabled !== false,
  };
}

export function shouldRunDhl(now = Date.now()) {
  const fiveMinuteBucket = Math.floor(Number(now) / (5 * 60 * 1000));
  return fiveMinuteBucket % 3 === 0;
}
