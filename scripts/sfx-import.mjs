// Imports source files as variants of one catalog cue.
// Usage: npm run sfx:import -- <cue> <file...>
import { MIX, SOUNDS } from '../src/data/sounds.ts';
import { cueOf, importFile } from './sfx-lib.mjs';

const [id, ...files] = process.argv.slice(2).filter((a) => a !== '--');
if (!id || files.length === 0) throw new Error('Usage: npm run sfx:import -- <cue> <file...>');
const cue = cueOf(SOUNDS, id);
files.forEach((f) => importFile(f, id, cue, MIX.level[cue.bus]));
