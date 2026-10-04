import { expect, it } from 'vitest';
import * as resources from './resources';
it('attributes measured containers to jobs and normalizes CPU to whole-host percentage', () => {
  expect(resources).toHaveProperty('parseContainerResources');
  const containers = [{ ID: 'abc', Names: 'PRIVATE-container', Labels: 'factory=1,factory-job=job-1' }, { ID: 'def', Names: 'factory-hermes', Labels: '' }].map((row) => JSON.stringify(row)).join('\n');
  const stats = [{ ID: 'abc', CPUPerc: '160.0%', MemUsage: '2GiB / 8GiB', BlockIO: '1MB / 2MB' }, { ID: 'def', CPUPerc: '8.0%', MemUsage: '256MiB / 2GiB', BlockIO: '0B / 0B' }].map((row) => JSON.stringify(row)).join('\n');
  const rows = resources.parseContainerResources(containers, stats, 8);
  expect(rows[0]).toMatchObject({ jobId: 'job-1', cpu: 20, memory: 2147483648 });
  expect(rows[1]).toMatchObject({ service: 'Hermes', cpu: 1, memory: 268435456 });
  expect(JSON.stringify(rows)).not.toContain('PRIVATE');
});
it('does not turn unavailable or malformed resource counters into zero', () => {
  expect(resources).toHaveProperty('parseContainerResources');
  const containers = JSON.stringify({ ID: 'a', Names: 'unknown', Labels: '' });
  expect(() => resources.parseContainerResources(containers, JSON.stringify({ ID: 'a', CPUPerc: '--', MemUsage: '--' }), 8)).toThrow();
});
