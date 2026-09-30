import { afterEach } from 'vitest';

// Long synchronous test files never return to the event loop, so the worker's status messages to the runner starve until its 60 s RPC timeout fires. One macrotask turn after each test lets them through.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
