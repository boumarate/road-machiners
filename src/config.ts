// Runtime config from .env. Missing or invalid values stop the boot.

function requireInt(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') throw new Error(`${name} is missing. Copy .env.example to .env.`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

export const CONFIG = {
  seed: requireInt('VITE_SEED', import.meta.env.VITE_SEED),
};
