# DHL Tracking for Jira — v6 Marketplace Configuration Build

This build turns the working scheduler into a configurable Forge app.

## New in v6

- Jira Configure page using `jira:adminPage`.
- DHL API key stored in encrypted Forge KVS secret storage.
- Project and Jira field mapping.
- Jira workflow status mapping.
- Delivery Status custom-field value mapping.
- Configurable internal-comment templates.
- Dynamic transition lookup — no hard-coded transition IDs.
- Test DHL connection button.
- Scheduler reads configuration at runtime.
- Scheduler timeout raised to 180 seconds.

## Upgrade steps

1. Back up the current project folder.
2. Copy these files over the existing project.
3. Run:

   npm install
   forge lint
   forge deploy -e development

4. Because v6 adds storage and an admin configuration page, run:

   forge install --upgrade -e development

5. Open Jira Administration > Apps > Manage apps > DHL Tracking > Configure.
6. Enter the DHL API key.
7. Verify all field and status mappings.
8. Enter a known tracking number and click Test DHL connection.
9. Save settings.
10. Check scheduler logs with:

   forge logs -e development

## Important

The DHL API key is intentionally not present in source code.
The scheduler will not process shipments until a key has been saved in the Configure page.
