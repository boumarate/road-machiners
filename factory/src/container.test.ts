import { describe, expect, it } from 'vitest';
import { dockerContainer } from './container';
import type { FactoryConfig, Run, RunOptions } from './types';

type Call = { cmd: string; args: string[]; opts?: RunOptions };

const cfg = { image: 'img:1', oauthToken: 'secret-token' } as FactoryConfig;

// Setup calls (network, proxy) answer per `setup`. Only the `docker run --rm` call answers with `code`.
function fakeRun(code = 0, setup: Record<string, { code: number; stdout?: string }> = {}): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'run' && args[1] === '--rm') return { code, stdout: '', stderr: 'boom' };
    const answer = setup[args.slice(0, 2).join(' ')] ?? { code: 0, stdout: args[0] === 'inspect' ? 'true' : '' };
    return { code: answer.code, stdout: answer.stdout ?? '', stderr: 'setup failed' };
  };
  return { run, calls };
}

const runCall = (calls: Call[]): Call => calls.find((call) => call.args[0] === 'run' && call.args[1] === '--rm') as Call;
const setupCalls = (calls: Call[]): string[] => calls.filter((call) => call !== runCall(calls)).map((call) => call.args.join(' '));

describe('dockerContainer', () => {
  it('passes the token by env only and mounts only the clone', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'do it', log: '/l.log' });
    const call = runCall(calls);
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.opts?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' });
    expect(call.opts?.input).toBe('do it');
    expect(call.opts?.logPath).toBe('/l.log');
    expect(call.args.filter((a) => a === '-v')).toHaveLength(1);
    expect(call.args).toContain('/w/c:/work');
    expect(call.args.slice(call.args.indexOf('-w'), call.args.indexOf('-w') + 2)).toEqual(['-w', '/work/game']);
    expect(call.args.filter((a) => a === '-e')).toHaveLength(7);
    expect(call.args.slice(call.args.indexOf('img:1'))).toEqual(['img:1', 'factory-agent', '-p', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose']);
  });

  it('puts a restricted agent on the internal network with the proxy env', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', openNetwork: false });
    const { args } = runCall(calls);
    expect(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2)).toEqual(['--network', 'roam-factory-agents']);
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) expect(args).toContain(`${key}=http://roam-factory-proxy:8888`);
    expect(args).toContain('NO_PROXY=localhost,127.0.0.1');
    expect(args).toContain('no_proxy=localhost,127.0.0.1');
  });

  it('runs an open agent on the default network with no proxy and no setup', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', openNetwork: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).not.toContain('--network');
    expect(calls[0].args.join(' ')).not.toContain('PROXY');
  });

  it('keeps a running proxy and an existing network as they are', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    expect(setupCalls(calls)).toEqual(['network inspect roam-factory-agents', 'inspect -f {{.State.Running}} roam-factory-proxy']);
  });

  it('creates the internal network and starts the proxy when missing', async () => {
    const { run, calls } = fakeRun(0, { 'network inspect': { code: 1 }, 'inspect -f': { code: 1 } });
    await dockerContainer(run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    const setup = setupCalls(calls);
    expect(setup).toContain('network create --internal roam-factory-agents');
    expect(setup).toContain('run -d --restart unless-stopped --name roam-factory-proxy --network roam-factory-agents img:1-proxy');
    expect(setup).toContain('network connect bridge roam-factory-proxy');
    expect(calls.indexOf(runCall(calls))).toBe(calls.length - 1);
  });

  it('fails loud when the proxy cannot start', async () => {
    const { run, calls } = fakeRun(0, { 'inspect -f': { code: 1 }, 'run -d': { code: 125 } });
    await expect(dockerContainer(run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('setup failed');
    expect(calls.some((call) => call.args[1] === '--rm')).toBe(false);
  });

  it('throws when the agent exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(2).run, cfg).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('exit 2');
  });

  it('runs a shell script with the given env and no token', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg).shell('/w/c', 'npm ci', '/l.log', { SAVE_SCOPE: 'dev' });
    const call = runCall(calls);
    expect(call.args).toContain('SAVE_SCOPE=dev');
    expect(call.args).toContain('/work/game');
    expect(call.args.slice(-3)).toEqual(['bash', '-lc', 'npm ci']);
    expect(call.opts?.env).toBeUndefined();
    expect(call.args).toContain('roam-factory-agents');
    expect(call.args).toContain('HTTPS_PROXY=http://roam-factory-proxy:8888');
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.args).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('throws when the shell exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(1).run, cfg).shell('/c', 'x', '/l')).rejects.toThrow('boom');
  });
});
