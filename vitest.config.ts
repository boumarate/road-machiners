import { defineConfig } from 'vitest/config';

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget.
// Model files load as assets, so view tests can inline them.
export default defineConfig({ assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], maxWorkers: 6, testTimeout: 30_000 } });
