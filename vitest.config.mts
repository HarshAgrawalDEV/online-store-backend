import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // Integration suites log in repeatedly from one address; rate-limit tests opt back in.
    env: { RATE_LIMIT_ENABLED: 'false' },
    include: ['tests/**/*.spec.ts'],
    // Database-backed suites run only through vitest.e2e.config.mts (pnpm test:e2e), which
    // refuses to touch a database that is not meant for testing.
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
