import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiContext, getGateway, putGateway, signIn, type GatewayConfig } from './helpers';

const HEALTHY: GatewayConfig = { minLatencyMs: 50, maxLatencyMs: 150, failureRate: 0, declineRate: 0, timeoutRate: 0 };

let ctx: APIRequestContext;
let original: GatewayConfig;

test.beforeAll(async () => {
  ctx = await apiContext();
  // Snapshot first, so afterAll can always put the shared backend back the way it was.
  original = await getGateway(ctx);
  await putGateway(ctx, HEALTHY);
});

test.afterAll(async () => {
  try {
    await putGateway(ctx, original);
  } finally {
    await ctx.dispose();
  }
});

test('creates a payment from the Console and watches it reach SUCCEEDED', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await expect(page.getByText('Connected')).toBeVisible();

  // Either the header button (payments exist) or the first-run button (empty database).
  const opener = page.getByRole('button', { name: /^(New payment|Create your first payment)$/ });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'New payment' });
  await expect(dialog).toBeVisible();
  const reference = `e2e-${Date.now()}`;
  await dialog.getByLabel('Reference').fill(reference);
  await dialog.getByLabel('Amount').fill('50.00');
  await dialog.getByLabel('Currency').selectOption('USD');
  await dialog.getByRole('button', { name: 'Create payment' }).click();

  await expect(dialog).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: reference });
  await expect(row).toBeVisible();
  await expect(row.getByText('$50.00')).toBeVisible();
  await expect(row.getByText('Succeeded')).toBeVisible({ timeout: 15_000 });
});

test('shows field errors from the backend under the input', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^(New payment|Create your first payment)$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New payment' });
  // 65 characters passes the client check but not the backend's 64 limit.
  await dialog.getByLabel('Reference').evaluate((el: HTMLInputElement) => el.removeAttribute('maxlength'));
  await dialog.getByLabel('Reference').fill('x'.repeat(65));
  await dialog.getByLabel('Amount').fill('1');
  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog.getByLabel('Reference')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toBeVisible();
});
