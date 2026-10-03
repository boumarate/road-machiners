import { availableParallelism, loadavg } from 'node:os';

// How many times slower a test runs than on a free machine, read from the host's load before the suite starts. A shared server with other jobs runs every test several times slower, so a fixed time budget fails tests that pass alone. The cap keeps a hung test from running for hours.
export function hostSlowdown(): number {
  return Math.min(8, Math.max(1, loadavg()[0] / availableParallelism()));
}
