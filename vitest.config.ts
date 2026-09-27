import { defineConfig } from 'vitest/config';

// Each 600-tile simulation worker holds terrain and routing grids. Two workers keep their measured combined heap below 1 GiB.
// Model files load as assets, so view tests can inline them.
export default defineConfig({ assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], maxWorkers: 2, testTimeout: 30_000 } });
