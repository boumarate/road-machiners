// Records progression traces: a bot plays each archetype on each seed, and every practice event goes to
// tmp/progression/<archetype>-<seed>.jsonl. The first line holds the run, then one trace line per event and one
// economy row per in-game day. A run the player did not survive ends early with a {"end":"death","turn":N} line.
// Each run is a child process. A run an error stops ends with {"end":"error","turn":N,"message":...}.
// Usage: npm run progression:record -- --archetypes trader,hunter --seeds 1,2,3 --turns 2000
// The markov archetype also needs --markov-turns <k>, the turns it keeps one goal.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TIME } from '../src/data/time.ts';
import { isArchetype } from '../src/sim/progression/bot.ts';
import { recordTurns } from '../src/sim/progression/record.ts';

const OUT_DIR = 'tmp/progression';
const USAGE = 'Usage: npm run progression:record -- --archetypes <a,b> --seeds <1,2> --turns <n> [--markov-turns <k>] [--tolerate-stalls true]';

const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
if (args.job) recordOne(args.job, args.turns, args.options);
else await recordAll(args);

function parseArgs(argv) {
  const flags = readFlags(argv);
  const turns = Number(flags.turns);
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`--turns must be a positive whole number. ${USAGE}`);
  const options = parseOptions(flags);
  if (flags.job) return { job: parseJob(flags.job), turns, options: requireMarkov([parseJob(flags.job).archetype], options) };
  const runs = parseRuns(flags);
  return { ...runs, turns, options: requireMarkov(runs.archetypes, options) };
}

// The markov bot keeps a goal for --markov-turns turns. Every other bot ignores it.
function parseOptions(flags) {
  return { ...parseMarkov(flags), ...parseTolerance(flags) };
}

function parseMarkov(flags) {
  if (flags['markov-turns'] === undefined) return {};
  const markovTurns = Number(flags['markov-turns']);
  if (!Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`--markov-turns must be a positive whole number. ${USAGE}`);
  return { markovTurns };
}

// --tolerate-stalls true counts NPC stalls in the economy rows instead of failing the run.
function parseTolerance(flags) {
  if (flags['tolerate-stalls'] === undefined) return {};
  if (flags['tolerate-stalls'] !== 'true') throw new Error(`--tolerate-stalls takes the value true. ${USAGE}`);
  return { tolerateStalls: true };
}

function requireMarkov(archetypes, options) {
  if (archetypes.includes('markov') && options.markovTurns === undefined) throw new Error(`The markov archetype needs --markov-turns <k>. ${USAGE}`);
  return options;
}

function readFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Bad argument ${name}. ${USAGE}`);
    flags[name.slice(2)] = value;
  }
  return flags;
}

function parseRuns(flags) {
  if (!flags.archetypes || !flags.seeds) throw new Error(`--archetypes and --seeds are required. ${USAGE}`);
  const archetypes = flags.archetypes.split(',');
  for (const a of archetypes) if (!isArchetype(a)) throw new Error(`Unknown archetype ${a}. ${USAGE}`);
  return { archetypes, seeds: flags.seeds.split(',').map(parseSeed) };
}

function parseSeed(text) {
  const seed = Number(text);
  if (!Number.isInteger(seed)) throw new Error(`Seed ${text} is not a whole number`);
  return seed;
}

// A job is one run, written as <archetype>:<seed>.
function parseJob(text) {
  const [archetype, seedText] = text.split(':');
  if (!isArchetype(archetype)) throw new Error(`Unknown archetype in job ${text}`);
  return { archetype, seed: parseSeed(seedText) };
}

// Runs go one at a time, so a batch never loads more than one core.
async function recordAll({ archetypes, seeds, turns, options }) {
  const jobs = archetypes.flatMap((archetype) => seeds.map((seed) => ({ archetype, seed })));
  console.log(`Recording ${jobs.length} runs of ${turns} turns, one at a time`);
  const failed = [];
  for (const job of jobs) {
    const code = await runChild(job, turns, options);
    if (code !== 0) failed.push(`${job.archetype}-${job.seed}`);
  }
  if (failed.length > 0) throw new Error(`Runs failed: ${failed.join(', ')}`);
  console.log(`Wrote ${jobs.length} traces to ${OUT_DIR}/`);
}

function runChild({ archetype, seed }, turns, options) {
  const viteNode = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));
  const script = fileURLToPath(import.meta.url);
  const markov = options.markovTurns === undefined ? [] : ['--markov-turns', String(options.markovTurns)];
  const tolerate = options.tolerateStalls ? ['--tolerate-stalls', 'true'] : [];
  const child = spawn(viteNode, [script, '--', '--job', `${archetype}:${seed}`, '--turns', String(turns), ...markov, ...tolerate], { stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

// Writes one trace, turn by turn, into a part file that becomes the trace only when the run finishes.
function recordOne({ archetype, seed }, turns, options) {
  const name = `${archetype}-${seed}`;
  const path = `${OUT_DIR}/${name}.jsonl`;
  mkdirSync(OUT_DIR, { recursive: true });
  const fd = openSync(`${path}.part`, 'w');
  const started = Date.now();
  writeSync(fd, `${JSON.stringify({ archetype, seed, turns, ...options })}\n`);
  const progress = { count: 0, end: null, lastTurn: 1 };
  try {
    writeSteps(fd, name, recordTurns(seed, archetype, turns, options), progress);
  } catch (error) {
    // A bot or rule error ends this run with an error marker, so the batch and the report go on without it.
    console.error(error);
    progress.end = { end: 'error', turn: progress.lastTurn, message: error instanceof Error ? error.message : String(error) };
    process.exitCode = 1;
  }
  const { count, end } = progress;
  // A run the player did not survive ends with the death marker.
  if (end) writeSync(fd, `${JSON.stringify(end)}\n`);
  closeSync(fd);
  renameSync(`${path}.part`, path);
  const ending = end ? `${end.end === 'death' ? 'died' : 'failed'} on turn ${end.turn}` : `${turns} turns`;
  console.log(`${name}: ${ending}, ${count} events in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

// Writes each step's trace lines and rows as it comes, and keeps the count, the death marker and the last turn in
// progress, so an error part way still leaves them.
function writeSteps(fd, name, steps, progress) {
  for (const step of steps) {
    const { world, lines, rows } = step;
    const written = [...lines, ...rows];
    if (written.length > 0) writeSync(fd, written.map((line) => `${JSON.stringify(line)}\n`).join(''));
    progress.count += lines.length;
    progress.end = step.death;
    progress.lastTurn = world.turn;
    if ((world.turn - 1) % TIME.turnsPerDay === 0) console.log(`${name}: day ${(world.turn - 1) / TIME.turnsPerDay} done, ${progress.count} events`);
  }
}
