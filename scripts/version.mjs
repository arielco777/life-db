#!/usr/bin/env node
// The app version lives in four files; they must agree (the updater compares versions).
//   node scripts/version.mjs            prints the version, fails if the files disagree
//   node scripts/version.mjs check v1.2.0   also fails unless it matches this tag
//   node scripts/version.mjs set 1.2.0  writes it everywhere
import { readFileSync, writeFileSync } from 'node:fs';

const files = {
  'package.json': {
    get: (t) => JSON.parse(t).version,
    set: (t, v) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
  'src-tauri/tauri.conf.json': {
    get: (t) => JSON.parse(t).version,
    set: (t, v) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
  'src-tauri/Cargo.toml': {
    get: (t) => /^version = "([^"]+)"/m.exec(t)?.[1],
    set: (t, v) => t.replace(/^version = "[^"]+"/m, `version = "${v}"`),
  },
  'src-tauri/Cargo.lock': {
    get: (t) => /name = "life-db"\nversion = "([^"]+)"/.exec(t)?.[1],
    set: (t, v) => t.replace(/(name = "life-db"\nversion = ")[^"]+(")/, `$1${v}$2`),
  },
};

const [cmd, arg] = process.argv.slice(2);
const read = (f) => readFileSync(f, 'utf8');

if (cmd === 'set') {
  if (!/^\d+\.\d+\.\d+$/.test(arg ?? '')) throw new Error('usage: version.mjs set X.Y.Z');
  for (const [f, { set }] of Object.entries(files)) writeFileSync(f, set(read(f), arg));
}

const versions = Object.entries(files).map(([f, { get }]) => [f, get(read(f))]);
const unique = new Set(versions.map(([, v]) => v));
if (unique.size !== 1) {
  console.error('Version mismatch:\n' + versions.map(([f, v]) => `  ${f}: ${v}`).join('\n'));
  process.exit(1);
}
const [version] = unique;
if (cmd === 'check' && arg !== `v${version}`) {
  console.error(`Tag ${arg} doesn't match the app version ${version} (expected v${version}).`);
  process.exit(1);
}
console.log(version);
