export type FlatMap = Record<string, string>;

export function flatten(obj: Record<string, unknown>, prefix = ''): FlatMap {
  const result: FlatMap = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Record<string, unknown>, path));
    } else if (typeof value === 'string') {
      result[path] = value;
    } else if (value === null || value === undefined) {
      result[path] = '';
    } else {
      result[path] = String(value);
    }
  }
  return result;
}

export function unflatten(flat: FlatMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in cursor) || typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return result;
}

export function parseJsonFile(content: string): FlatMap {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON root must be an object');
  }
  return flatten(parsed as Record<string, unknown>);
}

export function exportJson(flat: FlatMap, nested = false): string {
  const data = nested ? unflatten(flat) : flat;
  return JSON.stringify(data, null, 2);
}

/** Minimal YAML parser for common key: value and nested structures. */
export function parseYamlLite(content: string): FlatMap {
  const lines = content.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === '' || rest === '|' || rest === '>') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = unquoteYamlValue(rest);
    }
  }

  return flatten(root);
}

function unquoteYamlValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function exportYamlLite(flat: FlatMap): string {
  const nested = unflatten(flat);
  return serializeYaml(nested, 0).trimEnd() + '\n';
}

function serializeYaml(obj: Record<string, unknown>, depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      lines.push(serializeYaml(value as Record<string, unknown>, depth + 1));
    } else {
      const str = String(value ?? '');
      const needsQuotes = /[:#{}[\],&*!|>'"%@`]/.test(str) || str.includes('\n');
      lines.push(`${indent}${key}: ${needsQuotes ? JSON.stringify(str) : str}`);
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

const PO_ENTRY_RE =
  /msgid\s+"((?:\\.|[^"\\])*)"\s*\n(?:(?:msgid_plural\s+"((?:\\.|[^"\\])*)"\s*\n)?)msgstr(?:\[\d+\])?\s+"((?:\\.|[^"\\])*)"/g;

function unescapePo(str: string): string {
  return str.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export function parsePo(content: string): FlatMap {
  const result: FlatMap = {};
  let match: RegExpExecArray | null;
  let index = 0;

  PO_ENTRY_RE.lastIndex = 0;
  while ((match = PO_ENTRY_RE.exec(content)) !== null) {
    const msgid = unescapePo(match[1]);
    const msgstr = unescapePo(match[3]);
    if (msgid === '') continue;
    const key = msgid.includes('.') ? msgid : `msg.${index++}`;
    result[key] = msgstr;
  }

  if (Object.keys(result).length === 0) {
    const fallback = content.match(/msgid\s+"((?:\\.|[^"\\])*)"/);
    if (fallback?.[1]) {
      result['msg.0'] = unescapePo(fallback[1]);
    }
  }

  return result;
}

function escapePo(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function exportPo(flat: FlatMap, locale = 'en', projectName = 'Zerro L10n'): string {
  const header = [
    'msgid ""',
    'msgstr ""',
    `"Language: ${locale}\\n"`,
    `"Project-Id-Version: ${projectName}\\n"`,
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '',
  ].join('\n');

  const entries = Object.entries(flat).map(([key, value]) => {
    return [`msgid "${escapePo(key)}"`, `msgstr "${escapePo(value)}"`, ''].join('\n');
  });

  return header + '\n' + entries.join('\n');
}

export interface MarkdownSegment {
  key: string;
  text: string;
}

export function parseMarkdownResource(content: string): FlatMap {
  const segments = parseMarkdownSegments(content);
  const flat: FlatMap = {};
  for (const seg of segments) {
    flat[seg.key] = seg.text;
  }
  return flat;
}

export function parseMarkdownSegments(content: string): MarkdownSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: MarkdownSegment[] = [];
  let currentHeading = '';
  let currentParagraph: string[] = [];
  let headingIndex = 0;
  let paragraphIndex = 0;

  const flushParagraph = () => {
    const text = currentParagraph.join('\n').trim();
    if (text) {
      const slug = currentHeading
        ? slugify(currentHeading)
        : `paragraph.${paragraphIndex++}`;
      segments.push({ key: slug, text });
    }
    currentParagraph = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      flushParagraph();
      currentHeading = headingMatch[1].trim();
      headingIndex += 1;
      segments.push({
        key: `heading.${headingIndex}.${slugify(currentHeading)}`,
        text: currentHeading,
      });
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    currentParagraph.push(line);
  }
  flushParagraph();

  return segments;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'section';
}

export function exportMarkdownResource(flat: FlatMap): string {
  const lines: string[] = [];
  for (const [key, text] of Object.entries(flat)) {
    if (key.startsWith('heading.')) {
      lines.push(`## ${text}`);
      lines.push('');
    } else {
      lines.push(text);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

export type ImportFormat = 'json' | 'yaml' | 'po' | 'markdown';

export function parseFileContent(format: ImportFormat, content: string): FlatMap {
  switch (format) {
    case 'json':
      return parseJsonFile(content);
    case 'yaml':
      return parseYamlLite(content);
    case 'po':
      return parsePo(content);
    case 'markdown':
      return parseMarkdownResource(content);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

export function exportFileContent(
  format: ImportFormat,
  flat: FlatMap,
  opts?: { nested?: boolean; locale?: string; projectName?: string },
): string {
  switch (format) {
    case 'json':
      return exportJson(flat, opts?.nested ?? true);
    case 'yaml':
      return exportYamlLite(flat);
    case 'po':
      return exportPo(flat, opts?.locale, opts?.projectName);
    case 'markdown':
      return exportMarkdownResource(flat);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
