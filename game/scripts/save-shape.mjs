// Writes the saved shape of the current save format to src/three/save-shape.json.
// Usage: npm run save:shape. It refuses a new shape under the recorded format, since old saves of that format
// would load without migration.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SAVE_FORMAT } from '../src/three/save-migrations.ts';
import { newGameShape } from '../src/test/save-shape.ts';

const FILE = 'src/three/save-shape.json';
const format = `${SAVE_FORMAT.major}.${SAVE_FORMAT.minor}`;
const shape = newGameShape();

if (existsSync(FILE)) {
  const recorded = JSON.parse(readFileSync(FILE, 'utf8'));
  if (recorded.format === format && JSON.stringify(recorded.shape) !== JSON.stringify(shape)) {
    throw new Error(`The saved shape changed under save format ${format}. Add a migration step or bump SAVE_MAJOR in src/three/save-migrations.ts first.`);
  }
}
writeFileSync(FILE, `${JSON.stringify({ format, shape }, null, 1)}\n`);
console.log(`Wrote the save format ${format} shape to ${FILE}`);
