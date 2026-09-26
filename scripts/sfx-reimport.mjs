// Rebuilds every cue's files from the kept raw sources in tmp/sfx-raw/, oldest first, after an import change.
// Each file's source is read from its comment tag, so only kept variants are rebuilt.
// Usage: npm run sfx:reimport
import { execFileSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import { MIX, SOUNDS } from '../src/data/sounds.ts';
import { importFile, SFX_DIR } from './sfx-lib.mjs';

const sourceOf = (file) => {
  const tags = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=comment:format_tags=comment', '-of', 'default=nw=1:nk=1', `${SFX_DIR}/${file}`], { encoding: 'utf8' }).trim().split('\n');
  if (!tags[0]) throw new Error(`${file} has no source tag; import it again by hand`);
  return tags[0];
};

for (const [id, cue] of Object.entries(SOUNDS)) {
  const sources = cue.files.map(sourceOf);
  cue.files.forEach((f) => unlinkSync(`${SFX_DIR}/${f}`));
  for (const src of sources) importFile(src, id, cue, MIX.level[cue.bus]);
}
console.log(`${readdirSync(SFX_DIR).filter((f) => f.endsWith('.ogg')).length} files rebuilt`);
