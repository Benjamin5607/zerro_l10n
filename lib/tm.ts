import type { StoreData, TmEntry, Translation } from './types';
import { listTmEntries, upsertTmEntry } from './store';

export interface TmMatch {
  entry: TmEntry;
  score: number;
  matchType: 'exact' | 'fuzzy';
}

const FUZZY_THRESHOLD = 0.7;

export function exactMatch(
  store: StoreData,
  source: string,
  sourceLocale: string,
  targetLocale: string,
  orgId: string,
): TmEntry | undefined {
  return listTmEntries(store, orgId, sourceLocale, targetLocale).find(
    (e) => e.sourceText === source,
  );
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  const matrix: number[][] = Array.from({ length: lenA + 1 }, () =>
    Array<number>(lenB + 1).fill(0),
  );

  for (let i = 0; i <= lenA; i++) matrix[i][0] = i;
  for (let j = 0; j <= lenB; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = matrix[lenA][lenB];
  const maxLen = Math.max(lenA, lenB);
  return 1 - distance / maxLen;
}

function fuzzyScore(source: string, candidate: string): number {
  const jaccard = jaccardSimilarity(source, candidate);
  const levenshtein = levenshteinRatio(source, candidate);
  return Math.max(jaccard, levenshtein);
}

export function fuzzyMatch(
  store: StoreData,
  source: string,
  sourceLocale: string,
  targetLocale: string,
  orgId: string,
  threshold = FUZZY_THRESHOLD,
  limit = 5,
): TmMatch[] {
  const entries = listTmEntries(store, orgId, sourceLocale, targetLocale);
  const matches: TmMatch[] = [];

  for (const entry of entries) {
    if (entry.sourceText === source) continue;
    const score = fuzzyScore(source, entry.sourceText);
    if (score >= threshold) {
      matches.push({ entry, score, matchType: 'fuzzy' });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchTm(
  store: StoreData,
  query: string,
  orgId: string,
  sourceLocale?: string,
  targetLocale?: string,
  limit = 10,
): TmMatch[] {
  const exact = sourceLocale && targetLocale
    ? exactMatch(store, query, sourceLocale, targetLocale, orgId)
    : undefined;

  const results: TmMatch[] = [];
  if (exact) {
    results.push({ entry: exact, score: 1, matchType: 'exact' });
  }

  const entries = listTmEntries(store, orgId, sourceLocale, targetLocale);
  for (const entry of entries) {
    if (exact && entry.id === exact.id) continue;
    const score = fuzzyScore(query, entry.sourceText);
    if (score >= 0.5) {
      results.push({ entry, score, matchType: score >= FUZZY_THRESHOLD ? 'fuzzy' : 'fuzzy' });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function upsertTmFromApproved(
  store: StoreData,
  translation: Translation,
  sourceText: string,
  orgId: string,
  sourceLocale: string,
): TmEntry {
  return upsertTmEntry(store, {
    orgId,
    sourceLocale,
    targetLocale: translation.locale,
    sourceText,
    targetText: translation.text,
    projectId: translation.projectId,
    keyId: translation.keyId,
  });
}

export function upsertTmFromApprovedBatch(
  store: StoreData,
  orgId: string,
  sourceLocale: string,
  keys: Array<{ keyId: string; sourceText: string; translation: Translation }>,
): TmEntry[] {
  return keys
    .filter(({ translation }) => translation.status === 'approved' || translation.status === 'published')
    .map(({ keyId, sourceText, translation }) =>
      upsertTmFromApproved(store, translation, sourceText, orgId, sourceLocale),
    );
}
