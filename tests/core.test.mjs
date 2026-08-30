import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseDHLStatuses,
  collectStatusStrings,
  compareIssuesForFairRotation,
  currentDropdownValue,
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

test('collectStatusStrings gathers shipment and event status text', () => {
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
    'processed at facility',
  ]);
});

test('analyseDHLStatuses recognises delivered shipments', () => {
  const result = analyseDHLStatuses(['shipment delivered']);
  assert.equal(result.delivered, true);
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
