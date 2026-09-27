// Runtime config from .env. Missing or invalid values stop the boot.

function requireInt(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "")
    throw new Error(`${name} is missing. Copy .env.example to .env.`);
  const n = Number(raw);
  if (!Number.isInteger(n))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

function requirePositiveInt(name: string, raw: string | undefined): number {
  const value = requireInt(name, raw);
  if (value <= 0) throw new Error(`${name} must be positive, got ${value}`);
  return value;
}

function requireString(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "")
    throw new Error(`${name} is missing. Copy .env.example to .env.`);
  return raw.trim();
}

export const CONFIG = {
  startKit: requireString("VITE_START_KIT", import.meta.env.VITE_START_KIT),
  seed: requireInt("VITE_SEED", import.meta.env.VITE_SEED),
  combatShotMs: requirePositiveInt(
    "VITE_COMBAT_SHOT_MS",
    import.meta.env.VITE_COMBAT_SHOT_MS,
  ),
  combatReadMs: requirePositiveInt(
    "VITE_COMBAT_READ_MS",
    import.meta.env.VITE_COMBAT_READ_MS,
  ),
  saveTurns: requirePositiveInt("VITE_SAVE_TURNS", import.meta.env.VITE_SAVE_TURNS),
  travelHoldMs: requirePositiveInt("VITE_TRAVEL_HOLD_MS", import.meta.env.VITE_TRAVEL_HOLD_MS),
  travelFastSpeed: requirePositiveInt("VITE_TRAVEL_FAST_SPEED", import.meta.env.VITE_TRAVEL_FAST_SPEED),
};
