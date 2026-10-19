import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { apiContext, getGateway, signIn } from './helpers';

// On demand only: `npm run screenshots`. It runs an Arena auto-demo, so it is not part of test:e2e.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (npm run screenshots) to regenerate docs/media');

// Headless Chromium paints backdrop-blur cards as blank boxes on very tall captures (the live page is fine),
// so blur is switched off for the capture only and the viewport is sized to the content.
async function tall(page: Page, path: string) {
  await page.addStyleTag({ content: '*{backdrop-filter:none!important}' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height });
  await page.screenshot({ path });
}

const out = (name: string) => resolve(process.cwd(), '../docs/media', name);

test('capture console and arena screenshots', async ({ page }) => {
  const ctx = await apiContext();
  const before = await getGateway(ctx);
  try {
    await signIn(page);

    // The Console needs at least one payment (the create-payment e2e test makes one); the empty state is not captured.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Recent payments' })).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await page.screenshot({ path: out('console-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await tall(page, out('console-mobile.png'));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/arena');
    await page.getByRole('button', { name: 'Auto-demo' }).click();
    // Let a few coins spawn and travel so the pipeline is not empty.
    await page.waitForTimeout(9000);
    await page.screenshot({ path: out('arena-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await tall(page, out('arena-mobile.png'));

    // Reset restores the gateway config; the banner disappearing is the visible signal.
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Chaos active:')).toBeHidden();
  } finally {
    // Whatever happened, verify (not just trust) that the shared gateway is back as found.
    await page.waitForTimeout(500);
    expect(await getGateway(ctx)).toEqual(before);
    await ctx.dispose();
  }
});
