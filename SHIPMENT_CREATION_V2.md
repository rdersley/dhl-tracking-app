# DHL Shipment Creation from Jira — V2 Specification

This branch extends DHL Tracking for Jira with a safe Jira → DHL Express dispatch workflow while preserving the existing five-minute tracking engine.

## Goals

An agent can open a Jira/JSM issue, review shipment data sourced from mapped Jira fields, validate the destination with DHL, create a DHL Express shipment, receive the waybill/label/dispatch response, write selected DHL response values back to Jira, and then allow the existing tracker to take over automatically.

## Agent flow

1. Open Jira issue.
2. Open **Create DHL Shipment** panel/action.
3. App loads mapped Jira values into a shipment preview.
4. Required fields are checked locally before any DHL transaction.
5. Destination address is validated against DHL Express capability/address validation.
6. Validation errors are shown inline and no shipment is created.
7. If DHL returns warnings or normalized address information, show them before confirmation.
8. Agent reviews shipment details and confirms.
9. App creates shipment through MyDHL API.
10. App writes configurable response values back to Jira, including the tracking/waybill number.
11. App records a meaningful audit event.
12. Existing tracking scheduler automatically begins tracking the new waybill.
13. Duplicate shipment creation is blocked unless the admin explicitly allows a replacement/re-dispatch workflow.

## Separate DHL credentials

Tracking currently uses the DHL Unified Tracking API key. MyDHL shipment creation uses DHL Express MyDHL credentials and customer account information. These must be stored separately in Forge secret storage.

Secrets:

- MyDHL API username
- MyDHL API password

Configuration (non-secret):

- DHL Express account number
- Test/production environment selector
- Shipper defaults

Never log credentials, Authorization headers, API keys, or full label payloads.

## Supported environments

Admin chooses **Test** or **Production**. Test is the default until explicitly switched.

Production shipment creation must display a clear confirmation because it creates a real DHL transaction.

## Jira → DHL source mappings

All source values must be configurable. No Retail inMotion/Nuvriqo custom-field IDs are hard-coded.

### Recipient

- Company / organization
- Contact name
- Phone number
- Email address
- Address line 1
- Address line 2
- Address line 3
- City / locality
- State / province name
- State / province code
- Postal code
- Country code (ISO 2-letter)

### Shipper / pickup

Can use admin defaults or Jira field mappings:

- Company
- Contact name
- Phone
- Email
- Address lines
- City
- State / province
- Postal code
- Country code

Optional different pickup address is supported.

### Shipment

- Shipment date/time
- Product/service code (optional auto-selection later)
- Package count
- Weight
- Weight unit (kg/lb)
- Length
- Width
- Height
- Dimension unit (cm/in)
- Contents / shipment description
- Customer reference / Jira key
- Declared value
- Currency
- Incoterm where applicable
- Export reason / shipment purpose
- Duties/taxes payer where applicable

### International/customs data

Required only when applicable and should be collapsible/conditional:

- Commodity/line-item description
- Quantity
- Unit value
- Currency
- Net/gross weight
- Country of manufacture/origin
- HS/tariff code
- Export reason
- Invoice number/date
- Tax/VAT/EORI identifiers where applicable

The app must not guess customs values.

### Notifications

Optional DHL shipment notification settings:

- Recipient notification email
- Optional additional notification email
- Notification language where supported

## Validation before shipment creation

### Local checks

Block submission when required mapped data is missing or invalid:

- recipient name/company
- address
- city
- country code
- postal code where required
- contact details where required
- package weight > 0
- dimensions > 0 when configured
- valid numeric declared value when required
- required customs fields for international/customs shipments

### DHL checks

Use MyDHL address/capability validation before POST /shipments.

Surface:

- exact validation failure
- unsupported origin/destination
- invalid city/postcode/country combination
- pickup/delivery capability issues
- product/service issues
- DHL warnings and normalized values

Do not silently change an address and submit it. Let the agent review DHL-normalized/suggested values first.

## Shipment preview

Before confirmation show:

- Jira issue key
- recipient
- delivery address
- shipper/pickup address
- package count
- weight/dimensions
- contents/reference
- declared value/customs summary if applicable
- selected DHL environment
- real-transaction warning in Production

## Duplicate protection

Default behavior: if the configured tracking-number/waybill field already contains a value, block shipment creation.

Admin options:

- block always (default)
- allow replacement/re-dispatch after explicit confirmation

Store a compact issue+request fingerprint/idempotency marker so double-clicks/retries cannot create two shipments from the same confirmation.

## DHL → Jira response mappings

Configurable response mappings must include at least:

- Tracking number / waybill number
- Shipment ID
- Dispatch confirmation number if pickup requested
- DHL product/service
- Shipment creation timestamp
- Estimated delivery date/time when returned
- Label/document status
- Piece IDs
- DHL warnings/status summary

Core tracking-number mapping is required. Other mappings are optional.

## Labels and documents

Shipment response may contain/refer to DHL transport documents/labels.

V2 should support:

- display/download label to the agent when returned
- optional Jira attachment support only after security/size handling is verified
- never persist full base64 label data in KVS

## Pickup booking

Initial shipment creation supports either:

- regular pickup/no extra booking; or
- request courier/pickup where supported by configured MyDHL shipment request.

Standalone pickup booking (POST /pickups), modification and cancellation can be a follow-on screen, but response fields and dispatch confirmation mapping are reserved now.

## Error handling

No Jira tracking number is written unless DHL confirms shipment creation.

On failure:

- show DHL status/error safely
- preserve field-level validation where possible
- add an Activity Log failure entry without secrets
- leave Jira shipment fields unchanged unless explicitly designed as diagnostic fields
- allow correction and retry

HTTP 401/403: credential/account configuration guidance.
HTTP 400/422: validation guidance.
HTTP 409/idempotency-like response: do not blindly retry.
HTTP 429: show rate-limit guidance and retry only where safe.
5xx/network: transaction state must be reconciled before allowing an agent to create another shipment.

## Audit log

Significant events only:

- shipment preview validated
- address validation failed/passed
- shipment creation requested
- shipment created (waybill partially masked in general log if desired)
- Jira response fields updated
- pickup booked
- creation failed

Do not log credentials, authorization headers, full recipient personal data, customs documents, or label bytes.

## Permissions and security

- Restrict shipment creation UI to licensed users.
- Optional admin-configured source project list.
- Optional Jira permission check before allowing creation.
- MyDHL credentials stored as Forge secrets.
- Egress only to configured official DHL endpoint(s).
- Production/test environment clearly displayed.
- No vendor remote backend required for the core flow.

## Marketplace behaviour

Tracking-only V1 remains releasable independently. V2 shipment creation is developed/tested on `shipment-creation-v2` and is not merged into the release branch until DHL test-environment end-to-end QA passes.

## Acceptance tests

1. Missing required recipient field → blocked before DHL call.
2. Invalid address → DHL validation error displayed; no shipment created.
3. Valid test shipment → waybill returned and Jira tracking field populated.
4. DHL response mappings → configured Jira fields updated.
5. Existing waybill → duplicate creation blocked.
6. Double-click/retry → one shipment only.
7. API auth failure → safe actionable error, no secrets exposed.
8. DHL validation failure → no Jira tracking field written.
9. Successful shipment → tracker detects new waybill on next scheduler cycle.
10. Terminal tracker state from an old waybill does not block a newly created replacement waybill.
11. Activity Log records meaningful events only.
12. Test/Production environment cannot be confused visually.
