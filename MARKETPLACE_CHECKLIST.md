# DHL Tracking for Jira — Marketplace Release Checklist

## Release candidate

- [x] Configurable Jira field mapping.
- [x] Standard DHL status categories with Jira workflow mapping.
- [x] Configurable internal comment templates.
- [x] Dynamic Jira transitions (no hard-coded transition IDs).
- [x] DHL API key stored securely in Forge KVS secret storage.
- [x] Activity log and system-status panel.
- [x] Marketplace licensing enabled in `manifest.yml`.
- [ ] Final scheduler test after licensing-enabled deployment.
- [ ] Confirm Delivered updates fields, adds private comment, transitions, sets resolution, and stops polling.
- [ ] Confirm On Hold, Out for Delivery, Awaiting Collection, Failed and Returned mappings.
- [ ] Confirm rate-limit and DHL/API error behaviour.
- [ ] Test installation and configuration on a clean Jira/JSM site.

## Security and privacy

- [ ] Confirm the previously exposed DHL credential has been rotated/revoked.
- [x] Current source uses secret storage rather than a hard-coded DHL API key.
- [ ] Run `npm audit` and address blocking dependency vulnerabilities.
- [ ] Run `forge lint` and `forge eligibility` and retain results for release evidence.
- [ ] Verify Jira/JSM scopes are the minimum required for the released feature set.
- [ ] Complete Atlassian Forge security questionnaire.
- [ ] Complete Marketplace Privacy & Security tab.
- [ ] Publish Privacy Policy.
- [ ] Publish Terms/EULA.
- [ ] Publish support policy and support contact.

### Data-flow disclosure

For tracking, the app sends the configured DHL tracking number to `https://api-eu.dhl.com` to retrieve shipment status information.

Configuration and the app activity log are stored using Atlassian Forge app storage. The DHL API credential is stored using Forge secret storage. The app does not require a vendor-hosted remote backend for the tracking release.

The Marketplace Privacy & Security answers must accurately disclose DHL as the external service processing the tracking number and must describe any shipment data subsequently written to Jira.

## Marketplace listing

- [ ] Marketplace Partner profile completed/verified.
- [ ] Create Cloud app listing.
- [ ] Product name: **DHL Tracking for Jira** (subject to final Marketplace availability/brand review).
- [ ] Add tagline, category, logo and screenshots.
- [ ] Add full description, feature list and use cases.
- [ ] Add documentation URL.
- [ ] Add support URL/contact.
- [ ] Add Privacy Policy URL.
- [ ] Add Terms/EULA URL.
- [ ] Complete Privacy & Security tab.
- [ ] Configure Paid via Atlassian pricing/licensing.
- [ ] Enable Forge distribution/sharing as required.
- [ ] Link the Forge app to the Marketplace listing.
- [ ] Deploy final release to production.
- [ ] Perform clean-site production install test.
- [ ] Submit for Atlassian review.

## Release commands

From the release branch, first pull and validate:

```powershell
cd C:\jiraapps\dhl-tracking-app
git pull
npm install
npm audit
forge lint
forge eligibility
```

Do not deploy to production until the development build has passed the final tracking tests above.

When ready for production:

```powershell
forge deploy -e production
```

Then install/upgrade the production environment on the chosen clean test site before linking/submitting the Marketplace listing.

## Next release — not part of tracking v1

DHL shipment/dispatch creation, address validation, label generation, pickup booking, and writing newly created shipment/tracking details back to Jira are intentionally deferred until after the tracking release has been submitted to Marketplace.
