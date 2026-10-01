// A worker process of lock.test.ts. It adds one to a counter file many times, each under the lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { withLock, withLockSync } from '../lock';

const [lockDir, counter, rounds, mode] = process.argv.slice(2);

function bump(): void {
  const value = Number(readFileSync(counter, 'utf8'));
  writeFileSync(counter, String(value + 1));
}

for (let round = 0; round < Number(rounds); round += 1) {
  if (mode === 'sync') withLockSync(lockDir, 30_000, bump);
  else await withLock(lockDir, 30_000, async () => bump());
}
