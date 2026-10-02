import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { must } from './exec';
import type { Run } from './types';

// The job process gets its id in this variable, and its containers carry it as a label.
export const JOB_ID_ENV = 'FACTORY_JOB_ID';
export const jobLabel = (id: string): string => `factory-job=${id}`;

// Starts `factory run <args>` detached, with output appended to the log. Returns its pid.
export function spawnJob(args: string[], cwd: string, log: string, id: string): number {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const env = { ...process.env, [JOB_ID_ENV]: id };
    const child = spawn('npm', ['run', '-s', 'factory', '--', 'run', ...args], { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
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

async function jobContainers(run: Run, id: string): Promise<string[]> {
  const listed = must(await run('docker', ['ps', '-q', '--filter', `label=${jobLabel(id)}`]), 'docker ps');
  return listed.split('\n').map((line) => line.trim()).filter(Boolean);
}

// A job does its long work in containers. Between them it pushes, posts and moves cards, which a stop could leave half done.
export async function inContainer(run: Run, id: string): Promise<boolean> {
  return (await jobContainers(run, id)).length > 0;
}

// Other jobs run beside this one, so only the containers with its label go.
export async function killJob(run: Run, pid: number, id: string): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  for (const container of await jobContainers(run, id)) {
    must(await run('docker', ['rm', '-f', container]), `docker rm ${container}`);
  }
}
