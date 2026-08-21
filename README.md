# DHL Tracking for Jira

DHL Tracking for Jira is a configurable Atlassian Forge app for Jira and Jira Service Management that monitors DHL shipments and keeps Jira issues up to date.

## Marketplace V1 capabilities

- Scheduled DHL tracking every five minutes.
- Administrator configuration page in Jira.
- DHL API key stored using Forge secret storage.
- Configurable Jira project and field mappings.
- Standard DHL shipment categories mapped to Jira workflow statuses.
- Optional Delivery Status field updates.
- Optional private/internal Jira Service Management comment templates.
- Optional mapping of additional DHL response values into Jira fields.
- Dynamic workflow transition lookup — no hard-coded transition IDs.
- Configurable terminal states to stop unnecessary tracking after completion.
- DHL connection test and shipment preview.
- Administrator Activity Log and system-status panel.
- Marketplace licensing enabled for the production release.

## Release scope

Marketplace V1 is focused on tracking DHL shipments into Jira. Creating DHL shipments, generating labels, booking pickups and sending dispatch data from Jira to DHL are planned for a later release.

## Data flow

The app sends the configured DHL tracking number to `https://api-eu.dhl.com` to retrieve tracking information. Administrator-selected DHL information can then be written into Jira fields or used to perform configured workflow actions.

The V1 tracking release does not use a vendor-hosted remote backend.

## Development and test environments

Use `marketplace-v6-test` for functional testing. The Nuvriqo Jira site is used as the isolated staging test installation.

Use `marketplace-v1-release` only for the final Marketplace release candidate. This branch includes the licensed scheduled-trigger filter so inactive production licenses do not invoke tracking.

## Validation

Before promoting a release:

```powershell
npm install
npm audit
forge lint
forge eligibility
```

For staging functional testing:

```powershell
forge deploy -e staging
forge install --upgrade -e staging
```

For final production deployment from the release branch:

```powershell
forge deploy -e production --approve MAJOR_VERSION_RULE
```

## Important

The DHL API key must never be committed to source control. It is entered by a Jira administrator through the app configuration page and stored using Forge secret storage.

See `MARKETPLACE_SUBMISSION.md` and `MARKETPLACE_CHECKLIST.md` for the release and listing process.
