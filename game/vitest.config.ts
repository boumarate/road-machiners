import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { gameVersion } from './src/version';

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget. A machine with fewer cores gets one worker per core, since more workers starve each other and vitest's worker calls time out.
// Model files load as assets, so view tests can inline them. The settled runner starts each test only after the worker's status messages have their replies, so a long synchronous test cannot time them out.
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], runner: 'src/test/settled-runner.ts', maxWorkers: Math.min(6, availableParallelism()), testTimeout: 30_000 } });
