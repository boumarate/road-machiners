import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { hostSlowdown } from './src/test/host-load';
import { gameVersion } from './src/version';

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget. A machine with fewer cores gets one worker per core, since more workers starve each other and vitest's worker calls time out.
// A host already busy with other jobs gets half the cores. There each extra worker slows every test more than it adds throughput, and a test that runs past 60 s without yielding times out vitest's worker calls.
// The default test and hook timeouts scale with the host load, and `budget()` in src/test/budget.ts scales a test's own timeout the same way.
// Model files load as assets, so view tests can inline them.
const cores = availableParallelism();
const slowdown = hostSlowdown();
const workers = slowdown > 1 ? Math.max(1, Math.floor(cores / 2)) : Math.min(6, cores);
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], maxWorkers: workers, testTimeout: 30_000 * slowdown, hookTimeout: 10_000 * slowdown, provide: { hostSlowdown: slowdown } } });
