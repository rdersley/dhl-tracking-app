# DHL Tracking for Jira — Marketplace Assets & Listing Specification

This document is the final copy/paste pack for the Atlassian Marketplace listing.

## Identity

**App name:** DHL Tracking for Jira

**Partner:** Nuvriqo

**Tagline:** Automatically track DHL shipments and keep Jira tickets up to date.

**Hosting:** Cloud / Atlassian Forge

**Commercial model:** Paid via Atlassian

**Primary category:** IT Service Management / Operations

## Exactly 3 Marketplace highlights

### Highlight 1 — Automatic DHL tracking

**Title:** Track DHL shipments automatically

**Summary:** Check eligible shipments every five minutes and keep delivery progress visible on the Jira issue without repeated manual DHL lookups.

**Image:** Crop the settings/system-status or successful shipment tracking view to 580×330 px.

### Highlight 2 — Map DHL events to Jira

**Title:** Map delivery events to your workflow

**Summary:** Map standard DHL stages to Jira statuses, Delivery Status values and optional internal JSM comments using your own fields and workflow.

**Image:** Crop one expanded status mapping to 580×330 px.

### Highlight 3 — See what changed

**Title:** Built-in activity visibility

**Summary:** Review meaningful shipment updates, field changes, workflow transitions, errors and completed tracking from the administrator Activity Log.

**Image:** Crop the Activity Log showing a successful change to 580×330 px.

## Primary screenshots — 1840×900 px

1. **Configuration overview** — Caption: Configure the Jira project, DHL API access and site-specific Jira fields from one administration page.
2. **Field mapping** — Caption: Select Jira fields by name so the app works with each customer's Jira configuration instead of fixed custom-field IDs.
3. **Status mapping** — Caption: Map standard DHL shipment categories to Jira workflow statuses, Delivery Status values and optional internal comments.
4. **Activity Log** — Caption: Confirm the tracker is running and review meaningful shipment updates, workflow changes, errors and completed tracking.
5. **DHL connection test** — Caption: Validate DHL API access from the configuration page before enabling scheduled shipment tracking.

Do not show live customer names, email addresses, API keys, confidential ticket details or unredacted active tracking numbers in Marketplace screenshots.

## App logo

Required Marketplace upload: **144×144 px**, crisp PNG preferred, transparent or bounded square/chiclet treatment. Do not use Atlassian or Jira logos in the app logo.

Visual direction: Nuvriqo-owned identity; simple parcel/tracking-path motif with a small check/status indicator. Avoid copying DHL's corporate logo or wordmark inside the icon.

## Marketplace banner

Preferred high-resolution size: **1120×548 px** PNG/JPG.

Suggested text:

**DHL Tracking for Jira**

Automatic shipment tracking, Jira field updates and workflow automation.

**by Nuvriqo**

The banner should use the Nuvriqo/app visual identity and must not imitate Atlassian or DHL corporate branding.

## Short description

DHL Tracking for Jira automatically checks DHL shipment progress and updates Jira or Jira Service Management issues using configurable field mappings, workflow transitions, internal comments and terminal-state rules.

## Long description

DHL Tracking for Jira connects DHL shipment tracking with Jira and Jira Service Management so teams can keep delivery information on the ticket where work is already being managed.

Administrators choose the Jira project and fields used on their own site. No customer-specific custom field IDs are required. The app checks eligible issues every five minutes, retrieves the latest shipment information from DHL, groups detailed DHL events into standard shipment categories and applies the administrator's configured Jira actions.

### Key capabilities

- Scheduled DHL shipment tracking every five minutes.
- Configurable Jira project and field mappings.
- Standard shipment categories: Picked Up, In Transit, Out for Delivery, Awaiting Collection, On Hold / Exception, Customs / Clearance Delay, Delivery Attempted / Failed, Returned to Sender, Delivered and Unknown / Other.
- Configurable DHL category to Jira workflow-status mapping.
- Optional Delivery Status field updates.
- Optional internal Jira Service Management comment templates.
- Optional additional DHL-response-to-Jira field mappings.
- Configurable terminal events to stop unnecessary polling after completion.
- Administrator Activity Log and system status information.
- DHL API key stored using Forge secret storage.
- Dynamic Jira workflow transitions with no hard-coded transition IDs.

### Typical use cases

**Hardware dispatch tracking** — Keep replacement hardware shipments visible on the service request that triggered the dispatch.

**Service desk fulfilment** — Give support teams current shipment information without repeatedly checking the carrier website.

**Workflow automation** — Move issues when shipments are out for delivery, awaiting collection, delivered or encounter configured exceptions.

## External service statement

A suitable DHL API credential/access is required. DHL service availability, API access and DHL's terms are separate from the Nuvriqo app and Atlassian Marketplace subscription.

Marketplace V1 tracks existing DHL shipments only. Shipment creation, label generation, pickup booking and dispatch creation from Jira are not included in V1.

## Security / Privacy copy

**External hostname:** `api-eu.dhl.com`

**Data sent:** The tracking number configured on an eligible Jira issue.

**Purpose:** Retrieve shipment tracking status and event information from DHL.

**Vendor-hosted backend:** None for Marketplace V1.

**Forge storage:** Administrator configuration and a limited Activity Log. DHL API credentials use Forge secret storage.

**Jira data access:** Read eligible Jira issues and current workflow state; write only configured Jira fields and workflow transitions.

**JSM access:** Add optional private/internal shipment comments when configured by an administrator.

**Data residency / Runs on Atlassian:** The app intentionally performs external egress to DHL for shipment tracking, so it is not expected to qualify for the Runs on Atlassian badge.

## Scope justification

- `read:jira-work` — Search configured issues, read tracking/current workflow state and discover available Jira transitions.
- `write:jira-work` — Update administrator-selected fields and perform configured workflow transitions.
- `write:servicedesk-request` — Add optional private Jira Service Management comments when configured.
- `storage:app` — Store app configuration, encrypted DHL credential and limited activity history.

## Support / Trust links

Use the published Nuvriqo Support Confluence pages for:

- Product documentation
- Installation & Setup
- Configuration Guide
- How Tracking Works
- Troubleshooting
- FAQ
- Security & Data Handling
- Release Notes
- Privacy Policy
- Terms of Use / EULA
- Support Policy and support contact

## Reviewer test notes

For Atlassian Marketplace review, provide a clean Jira/JSM test environment and explain:

1. Open Jira Administration > Apps > DHL Tracking.
2. Configure project and Jira field mappings.
3. Add a valid DHL API credential and use Test DHL connection.
4. Create or use an issue with a DHL tracking number in the configured field.
5. Configure one or more standard DHL category mappings.
6. Allow the five-minute scheduler to run.
7. Verify configured field/status/comment changes and the administrator Activity Log.

Do not provide production customer credentials or customer shipment data to reviewers.
