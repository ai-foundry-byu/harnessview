import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Scan the minimal fixture dir; user-scope config from ~/.claude provides
// the actual agent/skill/mcp nodes.
const FIXTURE = path.join(__dirname, 'tests', 'fixtures', 'test-harness');
const PORT = 14317;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node dist/server/index.js',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      HV_ROOT: FIXTURE,
      HV_OPEN: '0',
      HV_PORT: String(PORT),
    },
  },
});
