# DHL Tracking for Jira — Marketplace Submission Pack

## App identity

**Name:** DHL Tracking for Jira

**Tagline:** Automatically track DHL shipments and keep Jira tickets up to date.

**Hosting:** Atlassian Forge / Cloud

**Commercial model:** Paid via Atlassian

## Short description

DHL Tracking for Jira automatically checks DHL shipment progress and updates Jira or Jira Service Management issues using configurable field mappings, workflow transitions, internal comments and terminal-state rules.

## Long description

DHL Tracking for Jira connects DHL shipment tracking with Jira and Jira Service Management so teams can keep delivery information on the ticket where work is already being managed.

Administrators choose the Jira project and fields used on their own site. No customer-specific custom field IDs are required. The app checks eligible issues on a scheduled basis, retrieves the latest shipment information from DHL, groups detailed DHL events into standard shipment categories and applies the administrator's configured Jira actions.

### Key capabilities

- Scheduled DHL shipment tracking every five minutes.
- Configurable Jira project and field mappings.
- Standard DHL categories including Picked Up, In Transit, Out for Delivery, Awaiting Collection, On Hold / Exception, Customs / Clearance Delay, Delivery Attempted / Failed, Returned to Sender, Delivered and Unknown / Other.
- Configurable DHL category to Jira workflow-status mapping.
- Optional Delivery Status field updates.
- Optional internal Jira Service Management comment templates.
- Optional mapping of additional DHL response values into Jira fields.
- Configurable terminal events to stop unnecessary tracking after completion.
- Administrator Activity Log and system status information.
- DHL API key stored using Forge secret storage.
- Dynamic Jira workflow transitions; no hard-coded transition IDs.

## Intended customers

Service desks, IT operations, hardware teams, logistics teams and support organisations that manage DHL-dispatched equipment or deliveries in Jira or Jira Service Management.

## Release scope

Marketplace V1 is a tracking-only release. Creating DHL shipments, generating labels, booking pickups and sending dispatch data from Jira to DHL are intentionally excluded from V1 and planned for a later release.

## External data flow

The app sends the configured DHL tracking number to `https://api-eu.dhl.com` to retrieve shipment tracking information. DHL shipment information selected by the administrator may then be written into Jira fields or used to perform configured workflow actions.

The app does not use a vendor-hosted remote backend for the V1 tracking feature.

## Forge storage

Forge app storage is used for app configuration and a limited administrator activity log. The DHL API credential is stored using Forge secret storage. Runtime logging is also available through Forge logs.

## Marketplace security / privacy notes

- External egress: `https://api-eu.dhl.com`.
- Purpose of egress: retrieve DHL tracking information for a tracking number configured on a Jira issue.
- Jira access: the app reads eligible issues and writes only administrator-configured fields, comments and workflow transitions.
- Service Management access: used only for optional private/internal comments.
- App storage: configuration and limited operational audit information.
- Vendor backend: none for V1.
- Licensing: Forge Marketplace licensing enabled.
- Scheduled tracking is filtered so inactive production licenses do not invoke the scheduled tracker.
- Runs on Atlassian badge is not expected because the tracking feature intentionally sends a tracking number to DHL.

## Scope justification

### `read:jira-work`
Required to search configured Jira issues, read tracking fields and current workflow state, discover fields/statuses and determine available transitions.

### `write:jira-work`
Required to update configured Jira fields and perform configured workflow transitions.

### `write:servicedesk-request`
Required only when an administrator configures private/internal Jira Service Management shipment comments.

### `storage:app`
Required for administrator configuration, secure DHL API credential storage and the limited administrator activity log.

The release manifest intentionally does not request `read:servicedesk-request` because V1 does not read JSM request/comment data through the Service Management REST API.

## Listing links

Use the published Nuvriqo Confluence pages for:

- Product documentation
- Installation & Setup
- Configuration Guide
- How Tracking Works
- FAQ
- Troubleshooting
- Security & Data Handling
- Release Notes
- Privacy Policy
- Terms of Use / EULA
- Support Policy / Support contact

## Screenshot plan

Prepare clean screenshots from the Nuvriqo test site showing:

1. DHL Tracking settings landing page / system status.
2. Jira field mappings using field names.
3. Collapsed standard DHL status mappings.
4. One expanded status mapping showing Jira status, Delivery Status and comment template.
5. Activity Log showing a successful meaningful update.
6. DHL connection test / shipment preview with any sensitive tracking data obscured.

## Final pre-submission commands

```powershell
cd C:\jiraapps\dhl-tracking-app
git switch marketplace-v1-release
git pull
npm install
npm audit
forge lint
forge eligibility
forge deploy -e production --approve MAJOR_VERSION_RULE
```

Do not deploy the release branch to staging while relying on `filter.appIsLicensed: true` for production licensing tests unless the staging license state is intentionally configured for that test. Continue functional testing on `marketplace-v6-test` and promote only after it passes.

## Final human-entered Marketplace items

The following must be completed in Atlassian Marketplace Partner administration because they are listing/account settings rather than repository code:

- Partner/vendor verification.
- Paid via Atlassian pricing tiers.
- Logo and screenshot uploads.
- Privacy & Security questionnaire answers.
- Documentation/support/privacy/EULA URLs.
- Link Forge app to listing and enable distribution.
- Submit for Atlassian review.
