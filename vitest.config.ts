import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us File / Blob / FileReader etc. for the imageUtils tests.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
