# Marketplace Release Checklist

## Product readiness

- [ ] Configure page works on a clean Jira/JSM site.
- [ ] No customer-specific field IDs are required without configuration.
- [ ] No DHL credentials exist in source control.
- [ ] Dynamic transitions work with different Jira workflows.
- [ ] Internal comments are private JSM notes.
- [ ] Resolution is set when Delivered transitions to Resolved.
- [ ] Failed/terminal statuses stop being polled.
- [ ] DHL rate-limit behaviour is tested.
- [ ] Missing configuration produces clear errors.

## Security and privacy

- [ ] Rotate the DHL API key that was previously embedded in source code.
- [ ] Use only necessary Jira/JSM scopes.
- [ ] Complete Atlassian Marketplace security questionnaire.
- [ ] Publish Privacy Policy.
- [ ] Publish Terms/EULA.
- [ ] Publish support policy and support contact.
- [ ] Document data sent to DHL (tracking number).
- [ ] Document Forge KVS storage usage.
- [ ] Document retention/deletion behaviour.

## Marketplace listing

- [ ] Create/complete Atlassian Marketplace Partner profile.
- [ ] Create Cloud app listing.
- [ ] Add app name, tagline and category.
- [ ] Add logo and screenshots.
- [ ] Add long description and use cases.
- [ ] Complete Privacy & Security tab.
- [ ] Add documentation URL.
- [ ] Add support URL/contact.
- [ ] Enable Forge distribution.
- [ ] Link the Forge app to the Marketplace listing.
- [ ] Test installation/configuration on a clean site.

## Paid listing

When ready to submit as a paid app, add under `app:` in `manifest.yml`:

    licensing:
      enabled: true

Then implement and test license-state handling before production submission.
