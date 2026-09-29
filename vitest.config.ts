import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget.
// Model files load as assets, so view tests can inline them.
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(version) }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], maxWorkers: 6, testTimeout: 30_000 } });
