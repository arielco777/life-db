import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNotes } from '../scripts/release-notes.mjs';

describe('RELEASE_NOTES.md (DIST-2)', () => {
  it('returns the notes under the heading for the matching version', () => {
    expect(parseNotes('# Life DB 1.2.0\n\n- **Faster** month view\n', '1.2.0')).toEqual({
      version: '1.2.0',
      body: '- **Faster** month view',
    });
  });

  it('rejects notes written for another version', () => {
    expect(parseNotes('# Life DB 1.1.0\n\n- Old notes', '1.2.0').error).toMatch(/describes 1\.1\.0/);
  });

  it('rejects a missing heading, empty notes and placeholder text', () => {
    expect(parseNotes('- Notes without a heading').error).toMatch(/must start with/);
    expect(parseNotes('# Life DB 1.2.0\n\n  \n').error).toMatch(/no notes/);
    expect(parseNotes("# Life DB 1.2.0\n\n_Replace this with what's new._").error).toMatch(/placeholder/);
  });

  it('accepts a BOM and Windows line endings', () => {
    expect(parseNotes('﻿# Life DB 1.2.0\r\n\r\n- Fix\r\n', '1.2.0')).toMatchObject({
      body: '- Fix',
    });
  });

  it('the committed file is valid', () => {
    expect(parseNotes(readFileSync('RELEASE_NOTES.md', 'utf8')).error).toBeUndefined();
  });
});
