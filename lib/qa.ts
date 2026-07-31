import { randomUUID } from 'node:crypto';
import { findViolations, listTerms } from './glossary';
import type { GlossaryTerm, KeySegment, QaFinding, StoreData, Translation } from './types';
import { listGlossaryTerms, listKeys, listTranslations, replaceQaFindings, requireProject } from './store';

const PLACEHOLDER_PATTERNS = [
  /\{[a-zA-Z_][\w]*\}/g,
  /\{\{[a-zA-Z_][\w]*\}\}/g,
  /%[sdif]/g,
  /\{[a-zA-Z_][\w]*,\s*(?:plural|select|selectordinal|number|date|time)[^}]*\}/g,
];

const HTML_TAG_RE = /<\/?[a-zA-Z][\w:-]*(?:\s[^>]*)?\/?>/g;

function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

export function checkPlaceholders(source: string, target: string): string[] {
  const sourcePh = extractPlaceholders(source);
  const targetPh = extractPlaceholders(target);
  const issues: string[] = [];

  for (const ph of sourcePh) {
    if (!targetPh.includes(ph)) {
      issues.push(`Missing placeholder ${ph} in target`);
    }
  }

  for (const ph of targetPh) {
    if (!sourcePh.includes(ph)) {
      issues.push(`Extra placeholder ${ph} in target`);
    }
  }

  return issues;
}

export function checkHtmlTags(source: string, target: string): string[] {
  const sourceTags = (source.match(HTML_TAG_RE) ?? []).sort();
  const targetTags = (target.match(HTML_TAG_RE) ?? []).sort();
  const issues: string[] = [];

  if (sourceTags.join('|') !== targetTags.join('|')) {
    issues.push(`HTML tag mismatch: source [${sourceTags.join(', ')}] vs target [${targetTags.join(', ')}]`);
  }

  const openTags = target.match(/<([a-zA-Z][\w:-]*)[^/>]*(?<!\/)>/g) ?? [];
  const closeTags = target.match(/<\/([a-zA-Z][\w:-]*)>/g) ?? [];
  if (openTags.length !== closeTags.length) {
    issues.push('Unbalanced HTML tags in target');
  }

  return issues;
}

export function checkLength(target: string, maxLength?: number): string[] {
  if (maxLength === undefined) return [];
  if (target.length > maxLength) {
    return [`Target length ${target.length} exceeds max ${maxLength}`];
  }
  return [];
}

export function checkGlossary(
  target: string,
  locale: string,
  terms: GlossaryTerm[],
): string[] {
  return findViolations(target, locale, terms).map((v) => v.message);
}

export function checkConsistency(
  translations: Translation[],
  keys: KeySegment[],
  locale: string,
): string[] {
  const issues: string[] = [];
  const byText = new Map<string, string[]>();

  for (const t of translations.filter((tr) => tr.locale === locale && tr.text.trim())) {
    const key = keys.find((k) => k.id === t.keyId);
    if (!key) continue;
    const existing = byText.get(t.text) ?? [];
    existing.push(key.key);
    byText.set(t.text, existing);
  }

  const sourceGroups = new Map<string, Map<string, string[]>>();
  for (const key of keys) {
    const t = translations.find((tr) => tr.keyId === key.id && tr.locale === locale);
    if (!t?.text.trim()) continue;
    if (!sourceGroups.has(key.sourceText)) {
      sourceGroups.set(key.sourceText, new Map());
    }
    const group = sourceGroups.get(key.sourceText)!;
    const variants = group.get(t.text) ?? [];
    variants.push(key.key);
    group.set(t.text, variants);
  }

  for (const [source, variants] of sourceGroups) {
    if (variants.size > 1) {
      const detail = [...variants.entries()]
        .map(([text, keyNames]) => `"${text}" (${keyNames.join(', ')})`)
        .join('; ');
      issues.push(`Inconsistent translation for identical source "${source.slice(0, 40)}...": ${detail}`);
    }
  }

  for (const [text, keyNames] of byText) {
    if (keyNames.length > 3) {
      issues.push(`Translation "${text.slice(0, 30)}" reused across ${keyNames.length} keys — verify consistency`);
    }
  }

  return issues;
}

function makeFinding(
  projectId: string,
  keyId: string,
  locale: string,
  rule: string,
  severity: QaFinding['severity'],
  message: string,
): QaFinding {
  return {
    id: randomUUID(),
    projectId,
    keyId,
    locale,
    rule,
    severity,
    message,
    createdAt: new Date().toISOString(),
  };
}

export function runQaForTranslation(
  key: KeySegment,
  translation: Translation,
  locale: string,
  glossaryTerms: GlossaryTerm[],
  allTranslations: Translation[],
  allKeys: KeySegment[],
): QaFinding[] {
  const findings: QaFinding[] = [];
  const { projectId, id: keyId } = key;
  const { text } = translation;

  for (const msg of checkPlaceholders(key.sourceText, text)) {
    findings.push(makeFinding(projectId, keyId, locale, 'placeholders', 'error', msg));
  }

  for (const msg of checkHtmlTags(key.sourceText, text)) {
    findings.push(makeFinding(projectId, keyId, locale, 'html_tags', 'error', msg));
  }

  for (const msg of checkLength(text, key.maxLength)) {
    findings.push(makeFinding(projectId, keyId, locale, 'length', 'warning', msg));
  }

  for (const msg of checkGlossary(text, locale, glossaryTerms)) {
    findings.push(makeFinding(projectId, keyId, locale, 'glossary', 'warning', msg));
  }

  for (const msg of checkConsistency(allTranslations, allKeys, locale)) {
    if (msg.includes(key.key)) {
      findings.push(makeFinding(projectId, keyId, locale, 'consistency', 'info', msg));
    }
  }

  return findings;
}

export function runQa(store: StoreData, projectId: string, locale: string): QaFinding[] {
  const project = requireProject(store, projectId);
  const keys = listKeys(store, projectId);
  const translations = listTranslations(store, projectId, locale);
  const glossaryTerms = listGlossaryTerms(store, project.orgId, projectId, locale);
  const allTranslations = listTranslations(store, projectId);
  const allKeys = keys;

  const findings: QaFinding[] = [];

  for (const key of keys) {
    const translation = translations.find((t) => t.keyId === key.id);
    if (!translation || !translation.text.trim()) {
      findings.push(
        makeFinding(projectId, key.id, locale, 'missing', 'warning', `Missing translation for key ${key.key}`),
      );
      continue;
    }
    findings.push(
      ...runQaForTranslation(key, translation, locale, glossaryTerms, allTranslations, allKeys),
    );
  }

  replaceQaFindings(store, projectId, locale, findings);
  return findings;
}
