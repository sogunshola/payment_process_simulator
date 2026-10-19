import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// A page wider than the viewport means something overflows; the page itself must never scroll sideways.
for (const width of [320, 375, 768, 1280]) {
  for (const path of ['/', '/arena']) {
    test(`no horizontal scroll at ${width}px on ${path}`, async ({ page }) => {
      await signIn(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
      // Settings must stay reachable on the narrowest phone.
      const settings = page.getByRole('banner').getByRole('button', { name: 'Settings' });
      await expect(settings).toBeInViewport();
    });
  }
}
