export type BucketChangeKind = 'a' | 'm' | 'r' | 'u' | 'c';

const BUCKET_CHANGE_LABELS: Record<BucketChangeKind, string> = {
  a: 'added',
  m: 'modified',
  r: 'removed',
  u: 'unclassified',
  c: 'reclassified',
};

const BUCKET_CHANGE_SIGNS: Partial<Record<BucketChangeKind, string>> = {
  a: '+',
  m: '~',
  r: '−',
};

export function formatBucketEntryCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'entry' : 'entries'}`;
}

export function formatBucketDiffLabel(kind: BucketChangeKind, count: number): string {
  const sign = BUCKET_CHANGE_SIGNS[kind];
  const amount = `${sign ?? ''}${count.toLocaleString('en-US')}`;
  return `${amount} ${BUCKET_CHANGE_LABELS[kind]}`;
}

export function isBucketExpanded(
  table: string,
  overrides: Readonly<Record<string, boolean>>,
  searching: boolean,
): boolean {
  return overrides[table] ?? searching;
}
