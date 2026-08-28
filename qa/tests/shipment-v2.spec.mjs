import { test, expect } from '@playwright/test';

const issueKey = process.env.QA_ISSUE_KEY || 'TEST-4';
const runDhlTestE2E = String(process.env.RUN_DHL_TEST_E2E || '').toLowerCase() === 'true';

async function openIssue(page) {
  await page.goto(`/browse/${issueKey}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/browse/${issueKey}`));
  await expect(page.locator('body')).toContainText(issueKey, { timeout: 20_000 });
}

test('Jira session is authenticated and QA issue loads', async ({ page }) => {
  await openIssue(page);
  await expect(page.locator('body')).not.toContainText(/log in to your account|sign in to continue/i);
});

test('DHL shipment issue module is present', async ({ page }) => {
  await openIssue(page);

  const body = page.locator('body');
  const moduleText = body.getByText(/DHL Shipment|Create DHL Shipment/i).first();
  await expect(moduleText).toBeVisible({ timeout: 30_000 });
});

test('DHL shipment panel opens without a fatal app error', async ({ page }) => {
  await openIssue(page);

  const trigger = page.getByText(/Create DHL Shipment|DHL Shipment/i).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click().catch(() => {});
  }

  await expect(page.locator('body')).not.toContainText(/Something went wrong|Failed to load the app|App failed to load/i);
  await expect(page.locator('body')).toContainText(/Create DHL Express Shipment|DHL Shipment/i, { timeout: 30_000 });
});

test('MyDHL TEST-mode validation path is safe', async ({ page }) => {
  test.skip(!runDhlTestE2E, 'Manual MyDHL TEST E2E was not requested.');

  await openIssue(page);
  const trigger = page.getByText(/Create DHL Shipment|DHL Shipment/i).first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click().catch(() => {});

  const body = page.locator('body');
  await expect(body).toContainText(/TEST MODE/i);

  const validate = page.getByRole('button', { name: /Validate address with DHL/i });
  await expect(validate).toBeVisible();

  if (await validate.isEnabled()) {
    await validate.click();
    await expect(body).toContainText(/Address validated|Validation failed|Shipment is not ready/i, { timeout: 30_000 });
  } else {
    await expect(body).toContainText(/Shipment is not ready/i);
  }

  // This workflow deliberately does not click "Create DHL Shipment" automatically.
  // Creating a MyDHL test shipment remains a separate explicit acceptance action.
});
