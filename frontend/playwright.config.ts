import { defineConfig } from '@playwright/test';

const port = process.env.PORT ?? '5173';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
