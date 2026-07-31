import type { TmMatch } from './tm';

export interface TranslatePromptInput {
  source: string;
  sourceLocale: string;
  targetLocale: string;
  glossaryBlock?: string;
  tmHits?: TmMatch[];
  styleGuide?: string;
  context?: string;
}

export interface ReviewPromptInput {
  source: string;
  target: string;
  sourceLocale: string;
  targetLocale: string;
  glossaryBlock?: string;
  styleGuide?: string;
  context?: string;
}

export interface QaPromptInput {
  source: string;
  target: string;
  sourceLocale: string;
  targetLocale: string;
  glossaryBlock?: string;
  rules?: string[];
}

export function buildTranslatePrompt(input: TranslatePromptInput): string {
  const parts = [
    'You are a professional translator for software localization.',
    `Translate the following text from ${input.sourceLocale} to ${input.targetLocale}.`,
    'Preserve all placeholders, HTML tags, and formatting exactly.',
    'Return ONLY the translated string with no explanation.',
    '',
  ];

  if (input.styleGuide) {
    parts.push('## Style Guide', input.styleGuide, '');
  }

  if (input.glossaryBlock) {
    parts.push(input.glossaryBlock, '');
  }

  if (input.tmHits && input.tmHits.length > 0) {
    parts.push('## Translation Memory References');
    for (const hit of input.tmHits.slice(0, 3)) {
      parts.push(
        `- (${Math.round(hit.score * 100)}% match) "${hit.entry.sourceText}" → "${hit.entry.targetText}"`,
      );
    }
    parts.push('');
  }

  if (input.context) {
    parts.push('## Context', input.context, '');
  }

  parts.push('## Source', input.source);
  return parts.join('\n');
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const parts = [
    'You are a localization reviewer.',
    `Review the ${input.targetLocale} translation against the ${input.sourceLocale} source.`,
    'Respond with JSON: {"approved": boolean, "revised": string|null, "notes": string}',
    '',
  ];

  if (input.styleGuide) {
    parts.push('## Style Guide', input.styleGuide, '');
  }

  if (input.glossaryBlock) {
    parts.push(input.glossaryBlock, '');
  }

  if (input.context) {
    parts.push('## Context', input.context, '');
  }

  parts.push('## Source', input.source, '', '## Target', input.target);
  return parts.join('\n');
}

export function buildQaPrompt(input: QaPromptInput): string {
  const rules = input.rules ?? [
    'placeholder preservation',
    'HTML tag integrity',
    'glossary compliance',
    'natural fluency',
  ];

  const parts = [
    'You are a localization QA specialist.',
    `Analyze the ${input.targetLocale} translation against the ${input.sourceLocale} source.`,
    'Respond with JSON: {"issues": [{"severity": "error"|"warning"|"info", "rule": string, "message": string}]}',
    '',
    '## Rules to check',
    ...rules.map((r) => `- ${r}`),
    '',
  ];

  if (input.glossaryBlock) {
    parts.push(input.glossaryBlock, '');
  }

  parts.push('## Source', input.source, '', '## Target', input.target);
  return parts.join('\n');
}

export function parseJsonFromLlm<T = unknown>(text: string): T {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new Error('Failed to parse JSON from LLM response');
  }
}

export interface ReviewResult {
  approved: boolean;
  revised: string | null;
  notes: string;
}

export function parseReviewResult(text: string): ReviewResult {
  const parsed = parseJsonFromLlm<Partial<ReviewResult>>(text);
  return {
    approved: Boolean(parsed.approved),
    revised: parsed.revised ?? null,
    notes: parsed.notes ?? '',
  };
}
