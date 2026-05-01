import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('Chat Flow', () => {
  test.afterEach(async () => {
    await closeApp();
  });

  test('send message and see response', async () => {
    const { page } = await launchApp();

    // Wait for chat to be ready
    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Find the chat input (textarea in chat view)
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // Type a message
    await textarea.fill('hello');
    await textarea.press('Enter');

    // Wait for response to appear (ChatMessage component)
    await page.waitForSelector('[class*="break-words"]', { timeout: 30000 });

    // Verify message appears (Status bar shows symbol count)
    const symbolCount = page.locator('[class*="text-emerald-500"]').first();
    await expect(symbolCount).toBeVisible();
  });

  test('chat input is focused on load', async () => {
    const { page } = await launchApp();

    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeFocused();
  });
});
