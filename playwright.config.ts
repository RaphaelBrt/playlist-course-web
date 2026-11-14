import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', timeout: 90_000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173/', channel: 'chrome', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  webServer: { command: 'npx vite preview --strictPort', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
});
