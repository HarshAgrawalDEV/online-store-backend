import fs from 'node:fs'
import path from 'node:path'

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const stub = (file: string) => path.resolve(__dirname, 'tests/e2e/stubs', file)

/**
 * The mobile app lives in its own repository. The end-to-end suite runs the app's real API
 * client, services and mappers, so it needs a checkout of the app: by default the sibling
 * folder ../mobile, or any path given in MOBILE_APP_DIR.
 */
const mobileDir = path.resolve(process.env.MOBILE_APP_DIR ?? path.join(__dirname, '..', 'mobile'))
if (!fs.existsSync(path.join(mobileDir, 'src', 'api', 'client.ts'))) {
  throw new Error(
    `The end-to-end tests need a checkout of the mobile app, but none was found at ${mobileDir}. ` +
      'Clone the mobile repository next to this one (as ../mobile) or set MOBILE_APP_DIR to its path.',
  )
}

/**
 * End-to-end suite. It runs the mobile app's own API client, services and mappers against the
 * real Payload handlers and a real PostgreSQL database. React Native modules are replaced by
 * tiny Node stand-ins.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [
      { find: /^@mobile\//, replacement: mobileDir + '/' },
      { find: /^@payload-config$/, replacement: path.resolve(__dirname, 'src/payload.config.ts') },
      { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' },
      { find: /^react-native$/, replacement: stub('react-native.ts') },
      { find: /^react-native-keychain$/, replacement: stub('keychain.ts') },
      { find: /^@env$/, replacement: stub('env.ts') },
      { find: /^.*\/assets\/images$/, replacement: stub('images.ts') },
    ],
  },
  server: { fs: { strict: false } },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    env: { RATE_LIMIT_ENABLED: 'false' },
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 90_000,
  },
})
