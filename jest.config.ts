import type { Config } from 'vitest/config';

export default {
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.*',
      '**/.vscode/**',
      '**/.cursor/**',
      '**/.antigravity/**',
    ],
    rootDir: './',
    watchman: false,
  },
} satisfies Config;
