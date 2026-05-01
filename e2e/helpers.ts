import { spawn } from 'child_process';
import { join } from 'path';
import { app } from 'electron';
import { ElectronApplication, Page, _electron as electron } from 'playwright';

let electronApp: ElectronApplication | null = null;

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  if (electronApp) {
    const page = await electronApp.firstWindow();
    return { app: electronApp, page };
  }

  const desktopRoot = join(__dirname, '..');
  const indexPath = join(desktopRoot, 'dist/electron/index.js');

  electronApp = await electron.launch({
    args: [indexPath],
    cwd: desktopRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test'
    },
    timeout: 30_000
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait for app to be ready
  await page.waitForTimeout(3000);

  return { app: electronApp, page };
}

export async function closeApp(): Promise<void> {
  if (electronApp) {
    await electronApp.close();
    electronApp = null;
  }
}
