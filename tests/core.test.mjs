import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseDHLStatuses,
  collectStatusStrings,
  compareIssuesForFairRotation,
  currentDropdownValue,
  latestDhlEvent,
  normalise,
  parseJiraDate,
} from '../src/core.mjs';

test('normalise safely handles nulls, whitespace and case', () => {
  assert.equal(normalise(null), '');
  assert.equal(normalise('  OUT For Delivery  '), 'out for delivery');
});

test('parseJiraDate handles Jira date-only and display-date values', () => {
  assert.equal(parseJiraDate('2026-08-30').toISOString(), '2026-08-30T00:00:00.000Z');
  assert.equal(parseJiraDate('30 Aug 2026').toISOString(), '2026-08-30T00:00:00.000Z');
  assert.equal(parseJiraDate('not-a-date'), null);
  assert.equal(parseJiraDate(null), null);
});

test('currentDropdownValue supports Jira option objects and plain strings', () => {
  assert.equal(currentDropdownValue({ value: 'Delivered' }), 'Delivered');
  assert.equal(currentDropdownValue('In Transit'), 'In Transit');
  assert.equal(currentDropdownValue(null), null);
});

test('collectStatusStrings gathers current status and newest event only', () => {
  const statuses = collectStatusStrings({
    status: { status: 'Transit' },
    events: [
      { status: 'Out for delivery', statusCode: 'OFD', description: 'With delivery courier' },
      'Processed at facility',
    ],
  });

  assert.deepEqual(statuses, [
    'transit',
    'out for delivery',
    'ofd',
    'with delivery courier',
  ]);
});

test('collectStatusStrings ignores older history such as a past customs clearance', () => {
  const statuses = collectStatusStrings({
    status: { statusCode: 'transit', description: 'With delivery courier' },
    events: [
      { timestamp: '2026-09-24T08:10:00', description: 'With delivery courier' },
      { timestamp: '2026-09-23T15:00:00', description: 'Customs clearance status updated' },
      { timestamp: '2026-09-22T09:00:00', description: 'Shipment on hold' },
    ],
  });

  const analysis = analyseDHLStatuses(statuses);
  assert.equal(analysis.onHold, false);
  assert.equal(analysis.outForDelivery, true);
});

test('latestDhlEvent uses timestamps when events arrive out of order', () => {
  const shipment = {
    events: [
      { timestamp: '2026-09-22T09:00:00', description: 'Processed at facility' },
      { timestamp: '2026-09-24T10:00:00', description: 'Delivered' },
    ],
  };
  assert.equal(latestDhlEvent(shipment).description, 'Delivered');
  assert.equal(latestDhlEvent({ events: [{ description: 'A' }, { description: 'B' }] }).description, 'A');
  assert.equal(latestDhlEvent({}), null);
});

test('analyseDHLStatuses recognises delivered shipments', () => {
  assert.equal(analyseDHLStatuses(['shipment delivered']).delivered, true);
  assert.equal(analyseDHLStatuses(['delivered']).delivered, true);
  assert.equal(analyseDHLStatuses(['delivered - signed for by: j smith']).delivered, true);
  assert.equal(analyseDHLStatuses(['the shipment has been delivered']).delivered, true);
});

test('analyseDHLStatuses does not treat negated delivery text as delivered', () => {
  for (const text of [
    'the shipment could not be delivered',
    'shipment not delivered - recipient not home',
    'the shipment has not been delivered',
    'not yet delivered',
    'your shipment will be delivered tomorrow',
    'shipment is expected to be delivered on friday',
    'shipment cannot be delivered - incorrect address',
    'undelivered shipment returned to sender',
  ]) {
    assert.equal(analyseDHLStatuses([text]).delivered, false, text);
  }
});

test('analyseDHLStatuses treats "could not be delivered" as a failed delivery', () => {
  assert.equal(analyseDHLStatuses(['the shipment could not be delivered']).deliveryFailed, true);
  assert.equal(analyseDHLStatuses(['shipment cannot be delivered']).deliveryFailed, true);
  assert.equal(analyseDHLStatuses(['shipment not delivered']).deliveryFailed, true);
});

test('analyseDHLStatuses recognises common failed and returned states', () => {
  assert.equal(analyseDHLStatuses(['recipient not home']).deliveryFailed, true);
  assert.equal(analyseDHLStatuses(['shipment returned to shipper']).returnedToSender, true);
});

test('analyseDHLStatuses recognises collection, hold, out-for-delivery and transit states', () => {
  assert.equal(analyseDHLStatuses(['ready for collection']).awaitingCollection, true);
  assert.equal(analyseDHLStatuses(['clearance event']).onHold, true);
  assert.equal(analyseDHLStatuses(['with courier for delivery']).outForDelivery, true);
  assert.equal(analyseDHLStatuses(['processed at facility']).inTransit, true);
});

test('fair rotation prioritises never-checked issues before previously checked issues', () => {
  const dateField = 'sent';
  const lastField = 'last';
  const issues = [
    { key: 'SD-2', fields: { sent: '2026-08-01', last: '2026-08-29T09:00:00Z' } },
    { key: 'SD-1', fields: { sent: '2026-08-05', last: null } },
  ];

  issues.sort((a, b) => compareIssuesForFairRotation(a, b, dateField, lastField));
  assert.deepEqual(issues.map((issue) => issue.key), ['SD-1', 'SD-2']);
});

test('fair rotation orders never-checked issues by oldest Date Sent', () => {
  const dateField = 'sent';
  const lastField = 'last';
  const issues = [
    { key: 'SD-2', fields: { sent: '2026-08-10', last: null } },
    { key: 'SD-1', fields: { sent: '2026-08-01', last: null } },
  ];

  issues.sort((a, b) => compareIssuesForFairRotation(a, b, dateField, lastField));
  assert.deepEqual(issues.map((issue) => issue.key), ['SD-1', 'SD-2']);
});

test('fair rotation uses oldest last-check first, then oldest Date Sent', () => {
  const dateField = 'sent';
  const lastField = 'last';
  const issues = [
    { key: 'SD-3', fields: { sent: '2026-08-03', last: '2026-08-29T10:00:00Z' } },
    { key: 'SD-2', fields: { sent: '2026-08-02', last: '2026-08-29T09:00:00Z' } },
    { key: 'SD-1', fields: { sent: '2026-08-01', last: '2026-08-29T09:00:00Z' } },
  ];

  issues.sort((a, b) => compareIssuesForFairRotation(a, b, dateField, lastField));
  assert.deepEqual(issues.map((issue) => issue.key), ['SD-1', 'SD-2', 'SD-3']);
});
