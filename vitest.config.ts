import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/main/tests/setup.ts'],
    alias: {
      '@main': resolve(__dirname, './src/main'),
      '@renderer': resolve(__dirname, './src/renderer/src'),
      '@common': resolve(__dirname, './src/common')
    }
  }
})
