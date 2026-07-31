#!/usr/bin/env npx tsx
/**
 * zerro-l10n CLI — pull | push | translate | qa | export
 */

const BASE =
  process.env.ZERRO_L10N_BASE_URL ||
  `http://localhost:${process.env.ZERRO_L10N_PORT || '4310'}`;

const WORKSPACE = `${BASE}/api/zeroai/workspace/l10n`;

interface CliOpts {
  projectId?: string;
  locale?: string;
  file?: string;
  format?: string;
}

function parseArgs(argv: string[]): { command: string; opts: CliOpts; rest: string[] } {
  const [, , command = '', ...rest] = argv;
  const opts: CliOpts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--project' || a === '-p') opts.projectId = rest[++i];
    else if (a === '--locale' || a === '-l') opts.locale = rest[++i];
    else if (a === '--file' || a === '-f') opts.file = rest[++i];
    else if (a === '--format') opts.format = rest[++i];
  }
  return { command, opts, rest };
}

async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(WORKSPACE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data;
}

async function readFile(path: string): Promise<string> {
  const fs = await import('fs/promises');
  return fs.readFile(path, 'utf8');
}

async function writeFile(path: string, content: string): Promise<void> {
  const fs = await import('fs/promises');
  await fs.writeFile(path, content, 'utf8');
}

async function resolveProjectId(opts: CliOpts): Promise<string> {
  if (opts.projectId) return opts.projectId;
  const projects = (await post('list_projects')) as Array<{ id: string; name: string }>;
  if (!projects?.length) throw new Error('No projects — create one in /embed or via API');
  console.log(`Using project: ${projects[0].name} (${projects[0].id})`);
  return projects[0].id;
}

async function cmdPull(opts: CliOpts) {
  const projectId = await resolveProjectId(opts);
  const locale = opts.locale || 'ko';
  const out = opts.file || `locales/${locale}.json`;
  const result = (await post('export_file', {
    projectId,
    locale,
    format: opts.format || 'json',
  })) as { content: string };
  await writeFile(out, result.content);
  console.log(`Pulled ${locale} → ${out}`);
}

async function cmdPush(opts: CliOpts) {
  const projectId = await resolveProjectId(opts);
  const locale = opts.locale || 'ko';
  const file = opts.file;
  if (!file) throw new Error('--file required for push');
  const content = await readFile(file);
  await post('import_file', {
    projectId,
    locale,
    format: opts.format || 'json',
    resourceName: file.split(/[/\\]/).pop() || 'imported',
    content,
  });
  console.log(`Pushed ${file} → project ${projectId} (${locale})`);
}

async function cmdTranslate(opts: CliOpts) {
  const projectId = await resolveProjectId(opts);
  const locale = opts.locale || 'ko';
  const result = await post('translate_batch', { projectId, locale, limit: 100 });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdQa(opts: CliOpts) {
  const projectId = await resolveProjectId(opts);
  const locale = opts.locale || 'ko';
  const result = await post('run_qa', { projectId, locale });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdExport(opts: CliOpts) {
  const projectId = await resolveProjectId(opts);
  const locale = opts.locale || 'ko';
  const out = opts.file || `export-${locale}.json`;
  const result = (await post('export_file', {
    projectId,
    locale,
    format: opts.format || 'json',
  })) as { content: string };
  await writeFile(out, result.content);
  console.log(`Exported → ${out}`);
}

function usage() {
  console.log(`zerro-l10n CLI (${BASE})

Usage:
  npx tsx cli/index.ts pull   [-p projectId] [-l locale] [-f file]
  npx tsx cli/index.ts push   [-p projectId] [-l locale] -f file
  npx tsx cli/index.ts translate [-p projectId] [-l locale]
  npx tsx cli/index.ts qa     [-p projectId] [-l locale]
  npx tsx cli/index.ts export [-p projectId] [-l locale] [-f file]

Env:
  ZERRO_L10N_BASE_URL  Service base URL (default http://localhost:4310)
  ZERRO_L10N_PORT      Port when BASE_URL unset (default 4310)
`);
}

async function main() {
  const { command, opts } = parseArgs(process.argv);
  switch (command) {
    case 'pull':
      await cmdPull(opts);
      break;
    case 'push':
      await cmdPush(opts);
      break;
    case 'translate':
      await cmdTranslate(opts);
      break;
    case 'qa':
      await cmdQa(opts);
      break;
    case 'export':
      await cmdExport(opts);
      break;
    case 'help':
    case '--help':
    case '-h':
      usage();
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
