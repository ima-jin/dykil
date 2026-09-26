import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See src/test/next-server-shim.ts for why this exists: Next's real
      // `next/server` pulls in a CJS-only dependency that breaks under
      // vitest's SSR module loading. Applies to both this app's own code and
      // (via `server.deps.inline` below) the published `@ima-jin/*` packages,
      // which also import `NextResponse` from `next/server`.
      'next/server': fileURLToPath(new URL('./src/test/next-server-shim.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    server: {
      // Force these through Vite's own resolution pipeline instead of
      // handing them straight to Node's native loader (which is what
      // vitest does for externalized node_modules deps by default).
      deps: {
        inline: [/^@ima-jin\//],
      },
    },
    deps: {
      // Plain `server.deps.inline` above does not, on its own, route an
      // already-built ESM dependency's OWN internal bare-specifier imports
      // through Vite's resolver (and therefore never sees `resolve.alias`) —
      // Node's native loader still handles those directly. Esbuild's
      // dependency-optimizer pass, by contrast, uses Vite's real resolver
      // (including aliases) while pre-bundling, which is what actually gets
      // the `next/server` alias above applied inside `@ima-jin/*`.
      optimizer: {
        ssr: {
          enabled: true,
          include: ['@ima-jin/auth', '@ima-jin/config', '@ima-jin/logger'],
        },
      },
    },
    coverage: {
      // lcov is what SonarCloud ingests (sonar.javascript.lcov.reportPaths).
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['app/**/*.ts', 'app/**/*.tsx', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/.next/**',
        '**/node_modules/**',
      ],
    },
  },
});
