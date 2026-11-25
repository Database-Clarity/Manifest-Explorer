import { describe, expect, it } from 'vitest';
import patchNoteData from '../manifestPatchNotes.generated.json';
import {
  manifestPatchNoteSearchTerms,
  resolveManifestPatchNote,
} from '../manifestPatchNotes';

describe('manifest patch notes', () => {
  it('contains the live Bungie RSS harvest as a unique, newest-first official dataset', () => {
    const notes = patchNoteData.notes;
    expect(notes.length).toBeGreaterThan(250);
    expect(notes[0]?.date.localeCompare(notes.at(-1)?.date ?? '')).toBeGreaterThan(0);
    expect(new Set(notes.map((note) => note.url)).size).toBe(notes.length);
    expect(notes.every((note) => note.url.startsWith('https://www.bungie.net/'))).toBe(true);
  });

  it('resolves an exact UTC day and normalizes timestamps before matching', () => {
    expect(resolveManifestPatchNote('2026-06-09')).toMatchObject({
      date: '2026-06-09',
      kind: 'update',
      number: '9.7.0',
      label: 'Update 9.7.0',
      url: 'https://www.bungie.net/7/en/News/Article/destiny_update_9_7_0',
    });
    expect(resolveManifestPatchNote('2026-06-10T01:30:00+02:00')?.number).toBe('9.7.0');
    expect(resolveManifestPatchNote('2026-07-07')?.number).toBe('9.7.0.3');
  });

  it('falls back to the previous day for launch-eve and next-day manifest captures', () => {
    expect(resolveManifestPatchNote('2023-02-28')).toMatchObject({
      date: '2023-02-27',
      number: '7.0.0.1',
    });
    expect(resolveManifestPatchNote('2026-01-14')).toMatchObject({
      date: '2026-01-13',
      number: '9.5.0.5',
    });
  });

  it('falls back to the following day for early captures and old ZIP timestamp drift', () => {
    expect(resolveManifestPatchNote('2017-11-15')).toMatchObject({
      date: '2017-11-16',
      kind: 'hotfix',
      label: 'Hotfix 11/16/2017',
    });
  });

  it('corrects Bungie version-title typos to the real 8.2.5.x sequence', () => {
    const notes = [
      resolveManifestPatchNote('2025-03-18'),
      resolveManifestPatchNote('2025-03-25'),
      resolveManifestPatchNote('2025-04-01'),
      resolveManifestPatchNote('2025-04-08'),
    ];
    expect(notes.map((note) => note?.number)).toEqual([
      '8.2.5.1',
      '8.2.5.2',
      '8.2.5.3',
      '8.2.5.4',
    ]);
    expect(notes[0]?.title).toContain('8.2.5.1');
    expect(notes[0]?.title).not.toContain('8.5.2.1');
  });

  it('labels early date-only hotfix notes and does not invent matches for silent builds', () => {
    const earlyHotfix = resolveManifestPatchNote('2017-09-12');
    expect(earlyHotfix).toMatchObject({
      kind: 'hotfix',
      label: 'Hotfix 9/12/17',
    });
    expect(earlyHotfix).not.toHaveProperty('number');
    expect(resolveManifestPatchNote('2026-09-01')).toBeNull();
    expect(resolveManifestPatchNote('2026-10-20')).toBeNull();
  });

  it('returns searchable label, title, and version terms without unrelated text', () => {
    expect(manifestPatchNoteSearchTerms('2026-06-09')).toContain('Update 9.7.0');
    expect(manifestPatchNoteSearchTerms('2026-06-09')).toContain('9.7.0');
    expect(manifestPatchNoteSearchTerms('2026-06-09')).not.toContain('patch notes');
    expect(resolveManifestPatchNote('2026-05-05')?.label).toBe('Update 9.5.6.3');
    expect(resolveManifestPatchNote('2023-03-08')).toMatchObject({
      kind: 'hotfix',
      number: '7.0.0.3',
      label: 'Hotfix 7.0.0.3',
    });
    expect(manifestPatchNoteSearchTerms('2026-10-20')).toBe('');
  });

  it('returns null for invalid dates instead of allowing adjacent-day matches', () => {
    for (const date of [
      '',
      'not-a-date',
      '2026-02-30',
      '2026-02-30T00:00:00Z',
      '2026-13-01',
    ]) {
      expect(resolveManifestPatchNote(date)).toBeNull();
      expect(manifestPatchNoteSearchTerms(date)).toBe('');
    }
  });
});
