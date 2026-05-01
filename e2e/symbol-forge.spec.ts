import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('Symbol Forge', () => {
  test.afterEach(async () => {
    await closeApp();
  });

  test('create symbol and verify it appears', async () => {
    const { page } = await launchApp();

    // Wait for app to be ready
    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Navigate to Symbol Forge via header nav
    const headerBtns = page.locator('[class*="px-3 py-1.5"]');
    const forgeBtn = headerBtns.filter({ hasText: 'Symbol' });
    await forgeBtn.first().click();

    // Wait for forge view (has "Commit Symbol" button)
    await page.waitForSelector('[class*="Commit Symbol"]', { timeout: 10000 });

    // Fill in the symbol ID field
    const inputs = page.locator('input');
    await inputs.first().fill('test-symbol-' + Date.now());

    // Save the symbol
    const saveBtn = page.locator('button:has-text("Commit Symbol")');
    await saveBtn.click();

    // Verify success message appears
    await page.waitForSelector('[class*="text-emerald-500"]', { timeout: 10000 });
  });
});
