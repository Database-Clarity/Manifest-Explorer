import generatedPatchNotes from './manifestPatchNotes.generated.json';

export interface ManifestPatchNote {
  date: string;
  kind: 'update' | 'hotfix';
  number?: string;
  label: string;
  title: string;
  url: string;
}

const PATCH_NOTES = generatedPatchNotes.notes as ManifestPatchNote[];
const NOTES_BY_DATE = new Map<string, ManifestPatchNote[]>();
const DAY_MS = 86_400_000;

for (const note of PATCH_NOTES) {
  const notesOnDate = NOTES_BY_DATE.get(note.date) ?? [];
  notesOnDate.push(note);
  NOTES_BY_DATE.set(note.date, notesOnDate);
}

function normalizeUtcDate(date: string): string | null {
  if (typeof date !== 'string' || !date.trim()) return null;
  const value = date.trim();
  const isoParts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (isoParts) {
    const year = Number(isoParts[1]);
    const month = Number(isoParts[2]);
    const day = Number(isoParts[3]);
    const calendarDate = new Date(0);
    calendarDate.setUTCFullYear(year, month - 1, day);
    if (
      calendarDate.toISOString().slice(0, 10) !==
      `${isoParts[1]}-${isoParts[2]}-${isoParts[3]}`
    ) {
      return null;
    }
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && normalized !== value) return null;
  return normalized;
}

function shiftUtcDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function bestNoteOnDate(date: string): ManifestPatchNote | null {
  const notes = NOTES_BY_DATE.get(date);
  if (!notes?.length) return null;
  return [...notes].sort(
    (a, b) =>
      Number(/\b(?:pc|steam)\b/i.test(a.title)) -
        Number(/\b(?:pc|steam)\b/i.test(b.title)) ||
      a.title.length - b.title.length ||
      a.url.localeCompare(b.url),
  )[0] ?? null;
}

/**
 * Resolve a manifest capture to an official Bungie patch note. The adjacent-day
 * fallbacks account for launch-eve notes and known archive timestamp drift.
 */
export function resolveManifestPatchNote(date: string): ManifestPatchNote | null {
  const utcDate = normalizeUtcDate(date);
  if (!utcDate) return null;

  return (
    bestNoteOnDate(utcDate) ??
    bestNoteOnDate(shiftUtcDate(utcDate, -1)) ??
    bestNoteOnDate(shiftUtcDate(utcDate, 1))
  );
}

/** Searchable patch-note names, titles, and version numbers for version pickers. */
export function manifestPatchNoteSearchTerms(date: string): string {
  const patchNote = resolveManifestPatchNote(date);
  if (!patchNote) return '';
  return [patchNote.label, patchNote.title, patchNote.number].filter(Boolean).join(' ');
}
