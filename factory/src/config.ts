import type { FactoryConfig } from './types';

// Every key is required. A missing key stops the factory before it touches GitHub or Telegram.
const KEYS = {
  repo: 'FACTORY_REPO',
  projectOwner: 'FACTORY_PROJECT_OWNER',
  projectNumber: 'FACTORY_PROJECT_NUMBER',
  home: 'FACTORY_HOME',
  webRoot: 'FACTORY_WEB_ROOT',
  publicUrl: 'FACTORY_PUBLIC_URL',
  image: 'FACTORY_IMAGE',
  oauthToken: 'CLAUDE_CODE_OAUTH_TOKEN',
  designModel: 'FACTORY_DESIGN_MODEL',
  buildModel: 'FACTORY_BUILD_MODEL',
  minVotes: 'FACTORY_MIN_VOTES',
  minAgeHours: 'FACTORY_MIN_AGE_HOURS',
  committeeBootstrapTelegram: 'FACTORY_COMMITTEE_BOOTSTRAP',
  committeeBootstrapGithub: 'FACTORY_COMMITTEE_BOOTSTRAP_GITHUB',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  committeeChat: 'FACTORY_COMMITTEE_CHAT',
  publicChannel: 'FACTORY_PUBLIC_CHANNEL',
  stageTimeoutMinutes: 'FACTORY_STAGE_TIMEOUT_MINUTES',
  releaseDays: 'FACTORY_RELEASE_DAYS',
  maintenanceHours: 'FACTORY_MAINTENANCE_HOURS',
} as const satisfies Record<keyof FactoryConfig, string>;

const NUMBERS = new Set<keyof FactoryConfig>(['projectNumber', 'minVotes', 'minAgeHours', 'stageTimeoutMinutes', 'releaseDays', 'maintenanceHours']);

export function loadConfig(env: Record<string, string | undefined>): FactoryConfig {
  const missing = Object.values(KEYS).filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Factory config is missing ${missing.join(', ')}. See .env.example.`);
  const entries = Object.entries(KEYS).map(([field, key]) => [field, parse(field as keyof FactoryConfig, key, env[key]!.trim())]);
  return Object.fromEntries(entries) as FactoryConfig;
}

function parse(field: keyof FactoryConfig, key: string, raw: string): string | number {
  if (!NUMBERS.has(field)) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number, got "${raw}".`);
  return value;
}
