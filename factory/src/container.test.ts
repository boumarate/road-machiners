import { describe, expect, it } from 'vitest';
import { dockerContainer } from './container';
import type { FactoryConfig, Run, RunOptions } from './types';

type Call = { cmd: string; args: string[]; opts?: RunOptions };

const cfg = { image: 'img:1', oauthToken: 'secret-token' } as FactoryConfig;

function fakeRun(code = 0): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { code, stdout: '', stderr: 'boom' }; };
  return { run, calls };
}

describe('dockerContainer', () => {
  it('passes the token by env only and mounts only the clone', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'do it', log: '/l.log' });
    const [call] = calls;
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.opts?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' });
    expect(call.opts?.input).toBe('do it');
    expect(call.opts?.logPath).toBe('/l.log');
    expect(call.args.filter((a) => a === '-v')).toHaveLength(1);
    expect(call.args).toContain('/w/c:/work');
    expect(call.args.slice(call.args.indexOf('-w'), call.args.indexOf('-w') + 2)).toEqual(['-w', '/work/game']);
    expect(call.args.filter((a) => a === '-e')).toHaveLength(1);
    expect(call.args.slice(call.args.indexOf('img:1'))).toEqual(['img:1', 'factory-agent', '-p', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose']);
  });

  it('throws when the agent exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(2).run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('exit 2');
  });

  it('runs a shell script with the given env and no token', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).shell('/w/c', 'npm ci', '/l.log', { SAVE_SCOPE: 'dev' });
    const [call] = calls;
    expect(call.args).toContain('SAVE_SCOPE=dev');
    expect(call.args).toContain('/work/game');
    expect(call.args.slice(-3)).toEqual(['bash', '-lc', 'npm ci']);
    expect(call.opts?.env).toBeUndefined();
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.args).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('throws when the shell exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(1).run, cfg).shell('/c', 'x', '/l')).rejects.toThrow('boom');
  });
});
