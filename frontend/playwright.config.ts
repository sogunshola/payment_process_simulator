import { defineConfig } from '@playwright/test';

// Needs the backend (:3000) and the Vite dev server (:5173) already running, plus backend/.env for the API key.
// reuseExistingServer means a developer's running servers are used as they are and never stopped.
export default defineConfig({
  testDir: './e2e',
  // Tests share one global gateway config, so they must not run in parallel.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'off' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
