# Hardware Handover & Dispatch Reconciliation

## Purpose
Make the SD -> HW -> SD replacement-device workflow resilient when Jira Automation is delayed, rate-limited or misses a run.

## Safe first rollout
The scheduled `hardware-sync` function runs every five minutes.

### Enabled by default: HW -> SD dispatch repair
For HW issues in `Dispatched` with both Tracking Number and Date Sent:
1. Find the linked SD issue in either Jira link direction.
2. Compare Tracking Number and Date Sent.
3. Copy only missing/changed values back to SD.
4. Transition SD to `Dispatched` only when it is not already there.
5. Add one private SD comment only when a repair was actually made.

This logic is idempotent: an already-correct SD/HW pair produces no write.

### Feature-gated: SD -> HW creation
Missing HW ticket creation exists in the handler but is disabled unless `HW_CREATE_ENABLED=true` and `HW_ISSUE_TYPE` is configured. This prevents duplicate or malformed production hardware requests until the exact destination issue type and field mapping have been verified.

## Current configurable environment values
- `HW_SD_PROJECT_KEY` (default `SD`)
- `HW_PROJECT_KEY` (default `HW`)
- `HW_SD_SENT_STATUS` (default `Sent to Hardware`)
- `HW_DISPATCHED_STATUS` (default `Dispatched`)
- `HW_SD_DISPATCHED_STATUS` (default `Dispatched`)
- `HW_TRACKING_FIELD` (default `customfield_10417`)
- `HW_DATE_SENT_FIELD` (default `customfield_10433`)
- `HW_SYNC_MAX_RESULTS` (default `100`)
- `HW_CREATE_ENABLED` (default disabled)
- `HW_ISSUE_TYPE` (required before creation can be enabled)
- `HW_LINK_TYPE` (default `Relates`)

## Next production step
Verify the exact HW issue type, required HW fields and SD -> HW copied-field mapping from the work Jira site, then enable creation in a controlled rollout. Keep the existing Jira Automation during shadow/reconciliation testing until duplicate protection and field parity are proven.
