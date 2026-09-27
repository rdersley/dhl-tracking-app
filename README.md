# Delivery Manager

A Jira Cloud app (Atlassian Forge, UI Kit) for teams that hand service requests
over to a hardware team and ship replacement devices with DHL. It:

- creates a linked hardware ticket from a service request,
- creates a DHL Express shipment (MyDHL API) from a hardware ticket and
  attaches the label,
- keeps the service request in step with the hardware ticket, and
- polls DHL tracking and updates delivery fields, workflow status and internal
  comments until the parcel is delivered.

A new install does nothing until a Jira administrator configures it.

## Features

| Where | What it does |
| --- | --- |
| **Admin page** (Jira settings → Apps → Delivery Manager) | All configuration, DHL credentials, a *Validate* check against your Jira, an operational preview of what the scheduler would pick up, and the last scheduler run's health. |
| **Issue action: Create Hardware Ticket** (service project) | Creates an issue in the hardware project, copies mapped fields, links it back. Records the created key on the source issue so a retry cannot create a duplicate. |
| **Issue action: Create DHL Shipment** (hardware project) | Sends the shipment to the MyDHL API (test or production mode; production needs an extra confirmation), writes the tracking number, date sent and delivery status back, attaches the label, and moves the issue to the dispatched status. Refuses to create a second shipment when a tracking number or shipment record already exists. |
| **Scheduler** (Forge trigger every 5 min; full cycle every 15 min) | 1. Copies tracking number / date sent from dispatched hardware tickets back to the linked service request and transitions it. 2. Optionally auto-creates hardware tickets for requests in the "sent to hardware" status (off by default). 3. Polls DHL tracking for dispatched requests and updates delivery status, date delivered, signed-for, workflow status and an internal comment. |

## Who can do what

The app calls Jira as itself, so it checks the calling user first:

- **Admin page:** Jira administrators only (global *Administer Jira*).
- **Create Hardware Ticket:** *Browse projects* and *Edit issues* on the
  service request, and *Create issues* in the hardware project.
- **Create DHL Shipment:** *Browse projects* and *Edit issues* on the hardware
  ticket.

## Configuration

Everything is set on the admin page. Nothing site-specific is shipped as a
default; each feature stays off until the settings it needs are filled in.

| Setting | Needed for |
| --- | --- |
| Service project, hardware project | all features |
| Service statuses: sent to hardware, dispatched, out for delivery, awaiting collection, on hold, delivery failed, resolved (+ resolution) | scheduler transitions and DHL tracking |
| Hardware status: dispatched | dispatch reconciliation |
| Custom fields: tracking number, date sent, delivery status (single select), date delivered, signed for, last DHL check | DHL tracking and shipment write-back |
| Hardware issue type, link type, SD → HW field mappings | hardware ticket creation |
| Optional client restriction (field + allowed values) | limit DHL tracking to some clients |
| DHL tracking API key | DHL tracking |
| MyDHL API username/password, account number, product code, test/production mode | DHL shipment creation (off by default) |
| Batch size, delay between DHL calls, minimum days since sent, max search results | scheduler throttling |

Use **Validate** after saving: it checks every project, status, field, issue
type, link type and credential against your site.

## External services (egress)

The manifest allows two outbound hosts. Both are needed only for the DHL
features and are called from the app backend with credentials the admin
supplies; nothing is sent until those credentials are configured.

| Host | Why |
| --- | --- |
| `https://api-eu.dhl.com` | DHL Shipment Tracking API: read the status of parcels that have a tracking number. |
| `https://express.api.dhl.com` | MyDHL Express API: create shipments and fetch labels when an agent uses *Create DHL Shipment*. |

The configured URLs are validated server-side and must stay on these hosts.

### Data sent to DHL

- **Tracking:** the tracking number (query parameter) and the DHL API key
  (header). No Jira issue content is sent.
- **Shipment creation** (only when an agent submits the form): shipper and
  receiver name, company, address, city, county, postal code, country, and
  optional phone and email; package weight, dimensions and description; the
  shipment reference (defaults to the Jira issue key); the DHL account number,
  product code, planned ship date and pickup flag; MyDHL credentials (HTTP
  Basic auth).

### Data stored by the app

- Configuration and last scheduler health in Forge storage (KVS).
- DHL API key and MyDHL credentials as Forge KVS secrets (never returned to
  the browser).
- Jira issue properties on the source issue (hardware keys created) and on the
  hardware ticket (tracking number and dispatch confirmation), used for
  duplicate prevention.

Logs contain issue keys, counts and HTTP status codes with a short reason, not
API response bodies.

## Limits

- The full scheduler cycle runs every 15 minutes (Forge fires every 5; two out
  of three runs exit immediately). Function timeout is 180 seconds.
- Each cycle searches at most 100 issues per query and checks at most 50 DHL
  tracking numbers (default 10) with a 1-15 second delay between calls (default
  3 s). DHL rate-limit responses stop the cycle early.
- Shipments that need a customs declaration are not supported yet.
- One package per shipment. Labels over about 4.5 MB are not attached.
- DHL tracking uses the EU endpoint (`api-eu.dhl.com`) only.
- Up to 50 SD → HW field mappings and 100 client restriction values. The
  project picker lists the first 100 projects.

## Development

```bash
npm install
npm test          # unit tests (node --test)
forge lint
```

Pure logic lives in `src/*.mjs` and is unit tested in `tests/`. Forge handlers
are `src/scheduler.js`, `src/settings-resolver.js`,
`src/hardware-action-resolver.js` and `src/shipment-action-resolver.js`; UI Kit
screens are in `src/frontend/`.
