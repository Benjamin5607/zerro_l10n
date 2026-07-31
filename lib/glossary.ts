import type { GlossaryTerm } from './types';
import { deleteGlossaryTerm, listGlossaryTerms, upsertGlossaryTerm } from './store';
import type { StoreData } from './types';

export interface GlossaryViolation {
  term: GlossaryTerm;
  type: 'preferred_missing' | 'forbidden_present';
  message: string;
}

export function listTerms(
  store: StoreData,
  orgId: string,
  projectId?: string,
  locale?: string,
): GlossaryTerm[] {
  return listGlossaryTerms(store, orgId, projectId, locale);
}

export function upsertTerm(
  store: StoreData,
  data: Omit<GlossaryTerm, 'id' | 'createdAt' | 'updatedAt'>,
): GlossaryTerm {
  return upsertGlossaryTerm(store, data);
}

export function deleteTerm(store: StoreData, termId: string): void {
  deleteGlossaryTerm(store, termId);
}

function containsTerm(text: string, term: string, caseSensitive: boolean): boolean {
  if (caseSensitive) {
    return text.includes(term);
  }
  return text.toLowerCase().includes(term.toLowerCase());
}

export function findViolations(text: string, locale: string, terms: GlossaryTerm[]): GlossaryViolation[] {
  const violations: GlossaryViolation[] = [];
  const localeTerms = terms.filter((t) => t.locale === locale || !t.translation);

  for (const term of localeTerms) {
    if (term.forbidden && containsTerm(text, term.term, term.caseSensitive)) {
      violations.push({
        term,
        type: 'forbidden_present',
        message: `Forbidden term "${term.term}" found in text`,
      });
    }

    if (term.preferred && term.translation) {
      const hasSource = containsTerm(text, term.term, term.caseSensitive);
      const hasPreferred = containsTerm(text, term.translation, term.caseSensitive);
      if (hasSource && !hasPreferred) {
        violations.push({
          term,
          type: 'preferred_missing',
          message: `Preferred translation "${term.translation}" for term "${term.term}" is missing`,
        });
      }
    }
  }

  return violations;
}

export function buildGlossaryPromptBlock(terms: GlossaryTerm[], locale: string): string {
  const relevant = terms.filter((t) => t.locale === locale || t.translation);
  if (relevant.length === 0) {
    return '';
  }

  const lines = ['## Glossary', 'Follow these terminology rules strictly:', ''];

  for (const term of relevant) {
    const flags: string[] = [];
    if (term.preferred) flags.push('preferred');
    if (term.forbidden) flags.push('forbidden');
    const flagStr = flags.length ? ` (${flags.join(', ')})` : '';

    if (term.translation) {
      lines.push(`- **${term.term}** → **${term.translation}**${flagStr}`);
    } else {
      lines.push(`- **${term.term}**${flagStr}`);
    }
    if (term.definition) {
      lines.push(`  Definition: ${term.definition}`);
    }
  }

  return lines.join('\n');
}
