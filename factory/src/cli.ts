// The factory command line. Usage: npm run factory -- <tick | run <stage> <issue|-> | intake>
import { realContext } from './context';
import { drainInbox } from './inbox';
import { intake } from './intake';
import { runJob } from './job';
import { tick } from './tick';
import { guardTick } from './tick-guard';
import type { JobStage } from './types';

const JOB_STAGES: JobStage[] = ['design', 'implement', 'testing', 'release', 'maintenance', 'approve', 'change', 'adhoc'];

async function main(args: string[]): Promise<void> {
  process.loadEnvFile('.env');
  const ctx = realContext(process.env);
  const codeDir = process.cwd();
  const [command, stage, issue] = args;
  if (command === 'tick') {
    return guardTick(ctx, async () => {
      await drainInbox(ctx);
      await tick(ctx, codeDir);
    });
  }
  if (command === 'intake') return void (await intake(ctx));
  if (command === 'run') return runJob(ctx, parseStage(stage), issue === '-' ? null : parseIssue(issue), codeDir);
  throw new Error(`Unknown command "${command}". Use tick, run <stage> <issue|->, or intake.`);
}

function parseStage(value: string | undefined): JobStage {
  if (!JOB_STAGES.includes(value as JobStage)) throw new Error(`Unknown stage "${value}". Use one of ${JOB_STAGES.join(', ')}.`);
  return value as JobStage;
}

function parseIssue(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`"${value}" is not an issue number or change id.`);
  return number;
}

await main(process.argv.slice(2).filter((arg) => arg !== '--'));
