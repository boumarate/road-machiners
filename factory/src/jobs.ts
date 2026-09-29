import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { must } from './exec';
import type { Run } from './types';

// Starts `factory run <args>` detached, with output appended to the log. Returns its pid.
export function spawnJob(args: string[], cwd: string, log: string): number {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const child = spawn('npm', ['run', '-s', 'factory', '--', 'run', ...args], { cwd, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    if (child.pid === undefined) throw new Error('job process did not start');
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

// Only one job runs at a time, so every factory container belongs to the job being killed.
export async function killJob(run: Run, pid: number): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const listed = must(await run('docker', ['ps', '-q', '--filter', 'label=factory=1']), 'docker ps');
  for (const id of listed.split('\n').map((line) => line.trim()).filter(Boolean)) {
    must(await run('docker', ['rm', '-f', id]), `docker rm ${id}`);
  }
}
