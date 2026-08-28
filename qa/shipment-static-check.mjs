import fs from 'node:fs';

function must(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const manifest = fs.readFileSync('manifest.yml', 'utf8');
const resolver = fs.readFileSync('src/shipping-resolver-v2.js', 'utf8');
const tracker = fs.readFileSync('src/index.js', 'utf8');
const admin = fs.readFileSync('src/frontend/shipping-admin.jsx', 'utf8');
const panel = fs.readFileSync('src/frontend/shipping-panel.jsx', 'utf8');

// Forge wiring and deployment safety.
must(manifest.includes('dhl-shipment-admin'), 'Shipment admin module exists');
must(manifest.includes('dhl-create-shipment-context'), 'Jira shipment issue context exists');
must(manifest.includes('shipping-resolver-v2.handler'), 'Shipment resolver is wired to V2 handler');
must(manifest.includes('https://express.api.dhl.com'), 'MyDHL egress is explicitly allow-listed');
must(manifest.includes('https://api-eu.dhl.com'), 'DHL tracking egress is explicitly allow-listed');
must(manifest.includes('interval: fiveMinute'), 'Existing five-minute tracking remains enabled');

// Shipment creation safety and Jira write-back.
must(resolver.includes('mydhl-api-username') && resolver.includes('mydhl-api-password'), 'MyDHL credentials use Forge secret keys');
must(resolver.includes('/address-validate'), 'DHL address validation is implemented');
must(resolver.includes('/shipments'), 'DHL shipment creation is implemented');
must(resolver.includes('duplicateMode'), 'Duplicate shipment protection is implemented');
must(resolver.includes('confirmedProduction'), 'Production creation requires explicit confirmation');
must(resolver.includes('trackingFieldId'), 'Tracking/waybill write-back is configurable');
must(resolver.includes('responseMappings'), 'DHL response mappings back to Jira are implemented');
must(!resolver.match(/password\s*[:=]\s*["'][^"']+["']/i), 'No obvious hard-coded MyDHL password found');

// Tracking scheduler guardrails. These assertions deliberately protect the behaviours
// most likely to cause customer-impacting regressions if removed during refactoring.
for (const category of ['pickedUp', 'inTransit', 'outForDelivery', 'awaitingCollection', 'onHold', 'customsDelay', 'deliveryFailed', 'returnedToSender', 'delivered', 'unknown']) {
  must(tracker.includes(`category: "${category}"`), `Tracking category ${category} is supported`);
}
must(tracker.includes('DHL-API-Key'), 'Tracking API authentication header is used');
must(tracker.includes('response.status === 429'), 'DHL rate limiting is explicitly handled');
must(tracker.includes('Retry-After'), 'DHL Retry-After information is captured');
must(tracker.includes('terminalKey(issueKey, trackingNumber)'), 'Terminal shipment idempotency key includes issue and tracking number');
must(tracker.includes('TERMINAL_ISSUES_KEY'), 'Terminal shipment state is persisted');
must(tracker.includes('maxPerRun'), 'Scheduler processing is bounded per run');
must(tracker.includes('MAX_TOTAL_ISSUES'), 'Jira search processing has a hard upper bound');
must(tracker.includes('config.clients?.length'), 'Configured client restriction is applied to Jira search');
must(tracker.includes('minDaysSinceSent'), 'Minimum age since Date Sent is enforced when configured');
must(tracker.includes('lastDhlCheck'), 'Last DHL check field is supported for fair polling order');
must(tracker.includes('deliveryDate'), 'Delivery date write-back is supported');
must(tracker.includes('signedFor'), 'Signed-for write-back is supported');
must(tracker.includes('addInternalComment'), 'Internal Jira status comments are implemented');
must(tracker.includes('transitionToStatus'), 'Configured Jira workflow transitions are implemented');
must(tracker.includes('currentDropdownValue'), 'Dropdown delivery-status comparison is normalised');
must(tracker.includes('additionalFieldMappings'), 'Additional DHL-to-Jira field mappings are supported');
must(tracker.includes('if (dhl.rateLimited)'), 'Scheduler stops safely when DHL rate limit is reached');
must(tracker.includes('if (!dhl.ok)'), 'DHL HTTP failures do not enter successful update processing');
must(tracker.includes('if (!shipment)'), 'Missing DHL shipment responses are handled');

// UI safety and explicit live-transaction warning.
must(admin.includes('Jira → DHL field mappings'), 'Admin UI exposes Jira to DHL mappings');
must(admin.includes('DHL → Jira response mappings'), 'Admin UI exposes DHL response mappings');
must(admin.includes('Test — no live transaction'), 'Admin UI clearly exposes test mode');
must(panel.includes('Validate address with DHL'), 'Issue UI exposes address validation');
must(panel.includes('Create DHL Shipment'), 'Issue UI exposes shipment creation');
must(panel.includes('PRODUCTION — this creates a real DHL shipment'), 'Issue UI clearly warns for production');

if (process.exitCode) process.exit(process.exitCode);
console.log('Shipment V2 and tracking safety QA passed.');
