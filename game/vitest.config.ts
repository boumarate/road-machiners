import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget. A machine with fewer cores gets one worker per core, since more workers starve each other and vitest's worker calls time out.
// Model files load as assets, so view tests can inline them.
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(version), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], maxWorkers: Math.min(6, availableParallelism()), testTimeout: 30_000 } });
