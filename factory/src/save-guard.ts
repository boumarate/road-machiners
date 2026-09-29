const SAVE_FILE = 'src/three/save-migrations.ts';
const SAVE_MAJOR_LINE = /SAVE_MAJOR\s*=/;

// True when the diff adds or removes a SAVE_MAJOR assignment in the save migrations file.
export function changesSaveMajor(diff: string): boolean {
  return fileSections(diff)
    .filter((section) => section[0].endsWith(` b/${SAVE_FILE}`))
    .some((section) => hunkLines(section).some((line) => isChange(line) && SAVE_MAJOR_LINE.test(line)));
}

// Splits a unified diff into one list of lines per file, each starting at its `diff --git` header.
function fileSections(diff: string): string[][] {
  const sections: string[][] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  return sections;
}

// The lines after the first hunk header, so the `---` and `+++` file headers never count as changes.
function hunkLines(section: string[]): string[] {
  const start = section.findIndex((line) => line.startsWith('@@'));
  return start < 0 ? [] : section.slice(start + 1);
}

function isChange(line: string): boolean {
  return line.startsWith('+') || line.startsWith('-');
}
