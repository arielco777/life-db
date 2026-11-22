#!/usr/bin/env node
// What's new in a release lives in RELEASE_NOTES.md, written before tagging. The release
// workflow puts it in the GitHub release and in latest.json, whose notes the app shows
// before installing an update (DIST-2).
//
// The file starts with "# Life DB X.Y.Z" for the release it describes, then the notes:
//   node scripts/release-notes.mjs check v1.2.0   fails unless the file is ready for this tag
//   node scripts/release-notes.mjs body           prints the notes without the heading
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILE = 'RELEASE_NOTES.md';
const PLACEHOLDER = /replace this|TODO|TBD/i;

/** The notes for `version`, or an error message saying what's wrong with the file. */
export function parseNotes(text, version) {
  const [first = '', ...rest] = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const heading = /^# Life DB (\d+\.\d+\.\d+)\s*$/.exec(first);
  if (!heading) return { error: `${FILE} must start with "# Life DB X.Y.Z".` };
  if (version && heading[1] !== version) {
    return {
      error: `${FILE} describes ${heading[1]}, not ${version}. Write the notes for ${version} first.`,
    };
  }
  const body = rest.join('\n').trim();
  if (!body) return { error: `${FILE} has no notes under its heading.` };
  if (PLACEHOLDER.test(body)) return { error: `${FILE} still contains placeholder text.` };
  return { version: heading[1], body };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [cmd, tag] = process.argv.slice(2);
  const version = cmd === 'check' ? tag?.replace(/^v/, '') : undefined;
  if (cmd !== 'body' && !(cmd === 'check' && version)) {
    console.error('usage: release-notes.mjs check vX.Y.Z | body');
    process.exit(2);
  }
  const notes = parseNotes(readFileSync(FILE, 'utf8'), version);
  if (notes.error) {
    console.error(notes.error);
    process.exit(1);
  }
  console.log(cmd === 'body' ? notes.body : `${FILE} is ready for ${notes.version}.`);
}
