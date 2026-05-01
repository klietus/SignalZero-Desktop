import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('System Prompt', () => {
  test.afterEach(async () => {
    await closeApp();
  });

  test('edit and persist system prompt', async () => {
    const { page } = await launchApp();

    // Wait for app to be ready
    await page.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Find system prompt textarea
    const textareas = page.locator('textarea');
    const promptEditor = textareas.first();
    await expect(promptEditor).toBeVisible();

    // Get original content
    const original = await promptEditor.inputValue();

    // Edit the prompt
    await promptEditor.fill(original + '\n\nTEST-PROMPT-MARKER-' + Date.now());

    // Save
    const saveBtn = page.locator('button:has-text("Save")');
    await saveBtn.click();

    // Close and reopen to verify persistence
    await closeApp();
    const { page: page2 } = await launchApp();

    // Wait for app to be ready
    await page2.waitForSelector('[class*="pointer-events-auto"]', { timeout: 15000 });

    // Find system prompt textarea again
    const promptEditor2 = page2.locator('textarea').first();
    const restored = await promptEditor2.inputValue();

    expect(restored).toContain('TEST-PROMPT-MARKER-');
  });
});
