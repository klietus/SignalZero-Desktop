import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('Context Switching', () => {
  test.afterEach(async () => {
    await closeApp();
  });

  test('create new context and switch to it', async () => {
    const { page } = await launchApp();

    // Wait for app to be ready
    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Find context list in sidebar
    const contextList = page.locator('[class*="Contexts"]');
    await expect(contextList).toBeVisible();

    // Click new context button
    const newContextBtn = page.locator('button:has-text("New"), [class*="plus"], [class*="add"]').first();
    await newContextBtn.click();

    // Wait for new context to be active
    await page.waitForTimeout(2000);

    // Verify chat area is ready
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
  });
});
