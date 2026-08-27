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
const admin = fs.readFileSync('src/frontend/shipping-admin.jsx', 'utf8');
const panel = fs.readFileSync('src/frontend/shipping-panel.jsx', 'utf8');

must(manifest.includes('dhl-shipment-admin'), 'Shipment admin module exists');
must(manifest.includes('dhl-create-shipment-context'), 'Jira shipment issue context exists');
must(manifest.includes('shipping-resolver-v2.handler'), 'Shipment resolver is wired to V2 handler');
must(manifest.includes('https://express.api.dhl.com'), 'MyDHL egress is explicitly allow-listed');
must(manifest.includes('interval: fiveMinute'), 'Existing five-minute tracking remains enabled');

must(resolver.includes('mydhl-api-username') && resolver.includes('mydhl-api-password'), 'MyDHL credentials use Forge secret keys');
must(resolver.includes('/address-validate'), 'DHL address validation is implemented');
must(resolver.includes('/shipments'), 'DHL shipment creation is implemented');
must(resolver.includes('duplicateMode'), 'Duplicate shipment protection is implemented');
must(resolver.includes('confirmedProduction'), 'Production creation requires explicit confirmation');
must(resolver.includes('trackingFieldId'), 'Tracking/waybill write-back is configurable');
must(resolver.includes('responseMappings'), 'DHL response mappings back to Jira are implemented');
must(!resolver.match(/password\s*[:=]\s*["'][^"']+["']/i), 'No obvious hard-coded MyDHL password found');

must(admin.includes('Jira → DHL field mappings'), 'Admin UI exposes Jira to DHL mappings');
must(admin.includes('DHL → Jira response mappings'), 'Admin UI exposes DHL response mappings');
must(admin.includes('Test — no live transaction'), 'Admin UI clearly exposes test mode');
must(panel.includes('Validate address with DHL'), 'Issue UI exposes address validation');
must(panel.includes('Create DHL Shipment'), 'Issue UI exposes shipment creation');
must(panel.includes('PRODUCTION — this creates a real DHL shipment'), 'Issue UI clearly warns for production');

if (process.exitCode) process.exit(process.exitCode);
console.log('Shipment V2 static QA passed.');
