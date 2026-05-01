import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('Settings', () => {
  test.afterEach(async () => {
    await closeApp();
  });

  test('toggle voice enabled and verify persistence', async () => {
    const { page } = await launchApp();

    // Wait for app to be ready
    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Navigate to settings via header nav
    const headerBtns = page.locator('[class*="px-3 py-1.5"]');
    const settingsBtn = headerBtns.filter({ hasText: 'Settings' });
    await settingsBtn.first().click();

    // Wait for settings view
    await page.waitForSelector('[class*="Settings"]', { timeout: 10000 });

    // Find voice toggle (look for toggle input)
    const voiceToggle = page.locator('input[type="checkbox"]').first();
    await voiceToggle.click();

    // Close settings
    const closeBtn = page.locator('[class*="close"], [class*="back"], button:has-text("Back")');
    await closeBtn.first().click();

    // Reopen settings and verify toggle state persisted
    await settingsBtn.first().click();
    await page.waitForSelector('[class*="Settings"]', { timeout: 10000 });

    const toggleState = await voiceToggle.isChecked();
    expect(toggleState).toBeTruthy();
  });
});
