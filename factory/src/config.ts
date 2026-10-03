import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { FactoryConfig } from './types';

// Git tracks settings.env, so the server runs main's settings. `local` holds secrets and host paths and never leaves its host.
// A key in both would leave one of them dead, so it stops the factory.
export function readEnvFiles(settingsPath: string, localPath: string): Record<string, string> {
  const settings = parseEnv(readFileSync(settingsPath, 'utf8'));
  const local = parseEnv(readFileSync(localPath, 'utf8'));
  const both = Object.keys(settings).filter((key) => key in local);
  if (both.length > 0) throw new Error(`${both.join(', ')} set in both ${settingsPath} and ${localPath}. Keep each key in one file.`);
  return { ...settings, ...local } as Record<string, string>;
}

// Every key is required, except the itch keys. A missing key stops the factory before it touches GitHub or Telegram.
// Only the release uses the itch keys, so without them the release alone fails loud.
const KEYS = {
  repo: 'FACTORY_REPO',
  projectOwner: 'FACTORY_PROJECT_OWNER',
  projectNumber: 'FACTORY_PROJECT_NUMBER',
  home: 'FACTORY_HOME',
  webRoot: 'FACTORY_WEB_ROOT',
  publicUrl: 'FACTORY_PUBLIC_URL',
  image: 'FACTORY_IMAGE',
  oauthToken: 'CLAUDE_CODE_OAUTH_TOKEN',
  elevenlabsKey: 'ELEVENLABS_API_KEY',
  sfxMaxGenerations: 'SFX_MAX_GENERATIONS',
  designModel: 'FACTORY_DESIGN_MODEL',
  buildModel: 'FACTORY_BUILD_MODEL',
  triageEffort: 'FACTORY_TRIAGE_EFFORT',
  minVotes: 'FACTORY_MIN_VOTES',
  minAgeHours: 'FACTORY_MIN_AGE_HOURS',
  committeeBootstrapTelegram: 'FACTORY_COMMITTEE_BOOTSTRAP',
  committeeBootstrapGithub: 'FACTORY_COMMITTEE_BOOTSTRAP_GITHUB',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  committeeChat: 'FACTORY_COMMITTEE_CHAT',
  publicChannel: 'FACTORY_PUBLIC_CHANNEL',
  stageTimeoutMinutes: 'FACTORY_STAGE_TIMEOUT_MINUTES',
  replyRouteMinutes: 'FACTORY_REPLY_ROUTE_MINUTES',
  releaseDays: 'FACTORY_RELEASE_DAYS',
  itchTarget: 'ITCH_TARGET',
  butlerKey: 'BUTLER_API_KEY',
  maxJobsPerDay: 'FACTORY_MAX_JOBS_PER_DAY',
  triageWorkers: 'FACTORY_TRIAGE_WORKERS',
  designWorkers: 'FACTORY_DESIGN_WORKERS',
  implementWorkers: 'FACTORY_IMPLEMENT_WORKERS',
  verifyWorkers: 'FACTORY_VERIFY_WORKERS',
  testWorkers: 'FACTORY_TEST_WORKERS',
} as const satisfies Record<keyof FactoryConfig, string>;

const RELEASE_ONLY = new Set<keyof FactoryConfig>(['itchTarget', 'butlerKey']);

const NUMBERS = new Set<keyof FactoryConfig>(['projectNumber', 'sfxMaxGenerations', 'minVotes', 'minAgeHours', 'stageTimeoutMinutes', 'replyRouteMinutes', 'releaseDays', 'maxJobsPerDay', 'triageWorkers', 'designWorkers', 'implementWorkers', 'verifyWorkers', 'testWorkers']);

export function loadConfig(env: Record<string, string | undefined>): FactoryConfig {
  const missing = Object.entries(KEYS).filter(([field, key]) => !RELEASE_ONLY.has(field as keyof FactoryConfig) && !env[key]?.trim()).map(([, key]) => key);
  if (missing.length) throw new Error(`Factory config is missing ${missing.join(', ')}. See settings.env and .env.example.`);
  const entries = Object.entries(KEYS).map(([field, key]) => [field, read(field as keyof FactoryConfig, key, env[key]?.trim())]);
  return Object.fromEntries(entries) as FactoryConfig;
}

function read(field: keyof FactoryConfig, key: string, raw: string | undefined): string | number | null {
  return raw ? parse(field, key, raw) : null;
}

function parse(field: keyof FactoryConfig, key: string, raw: string): string | number {
  if (!NUMBERS.has(field)) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number, got "${raw}".`);
  return value;
}
