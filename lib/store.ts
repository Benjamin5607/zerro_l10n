import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalyticsSnapshot,
  ApiKey,
  AuditLog,
  BillingHook,
  CommunitySubmission,
  GlossaryTerm,
  Integration,
  Job,
  KeySegment,
  Member,
  Org,
  Project,
  QaFinding,
  Resource,
  Role,
  StoreData,
  TmEntry,
  Translation,
  TranslationStatus,
} from './types';
import { L10nError } from './types';

const STORE_FILENAME = 'store.json';

export function getDataDir(): string {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  // Vercel / serverless: only /tmp is writable
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'zerro-l10n');
  }
  const localData = path.join(process.cwd(), 'data');
  return localData;
}

export function getStorePath(): string {
  return path.join(getDataDir(), STORE_FILENAME);
}

function now(): string {
  return new Date().toISOString();
}

function emptyStore(): StoreData {
  return {
    orgs: [],
    members: [],
    projects: [],
    resources: [],
    keys: [],
    translations: [],
    tmEntries: [],
    glossaryTerms: [],
    jobs: [],
    qaFindings: [],
    integrations: [],
    apiKeys: [],
    auditLogs: [],
    billingHooks: [],
    analyticsSnapshots: [],
    communitySubmissions: [],
  };
}

function seedDemoProject(store: StoreData, orgId: string): StoreData {
  const ts = now();
  const projectId = randomUUID();
  const resourceId = randomUUID();

  const project: Project = {
    id: projectId,
    orgId,
    name: 'Zerro Demo',
    slug: 'zerro-demo',
    sourceLocale: 'en',
    targetLocales: ['ko', 'ja'],
    description: 'Sample localization project for Zerro AI L10n',
    styleGuide: 'Use concise, product-friendly tone. Preserve placeholders and HTML.',
    createdAt: ts,
    updatedAt: ts,
  };

  const resource: Resource = {
    id: resourceId,
    projectId,
    name: 'app',
    format: 'json',
    createdAt: ts,
    updatedAt: ts,
  };

  const sampleKeys: Array<{ key: string; sourceText: string; context?: string }> = [
    { key: 'app.title', sourceText: 'Zerro AI', context: 'Application title' },
    { key: 'app.welcome', sourceText: 'Welcome, {name}!', context: 'Greeting with placeholder' },
    { key: 'app.save', sourceText: 'Save changes', context: 'Primary action button' },
    { key: 'app.cancel', sourceText: 'Cancel', context: 'Secondary action button' },
    { key: 'app.error.network', sourceText: 'Network error. Please try again.', context: 'Error message' },
  ];

  const keys: KeySegment[] = sampleKeys.map((s) => ({
    id: randomUUID(),
    projectId,
    resourceId,
    key: s.key,
    sourceText: s.sourceText,
    context: s.context,
    createdAt: ts,
    updatedAt: ts,
  }));

  store.projects.push(project);
  store.resources.push(resource);
  store.keys.push(...keys);

  return store;
}

function seedDefaultOrg(store: StoreData): StoreData {
  const ts = now();
  const orgId = 'default';

  const org: Org = {
    id: orgId,
    name: 'Default Organization',
    slug: 'default',
    createdAt: ts,
    updatedAt: ts,
  };

  const owner: Member = {
    id: randomUUID(),
    orgId,
    email: 'owner@zerro.ai',
    name: 'Default Owner',
    role: 'owner',
    createdAt: ts,
    updatedAt: ts,
  };

  store.orgs.push(org);
  store.members.push(owner);

  const billing: BillingHook = {
    id: randomUUID(),
    orgId,
    provider: 'stripe',
    status: 'trial',
    plan: 'starter',
    seats: 5,
    createdAt: ts,
    updatedAt: ts,
  };
  store.billingHooks.push(billing);

  return seedDemoProject(store, orgId);
}

export async function loadStore(): Promise<StoreData> {
  const storePath = getStorePath();
  try {
    const raw = await readFile(storePath, 'utf-8');
    return JSON.parse(raw) as StoreData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStore();
    }
    throw err;
  }
}

export async function saveStore(store: StoreData): Promise<void> {
  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getStorePath(), JSON.stringify(store, null, 2), 'utf-8');
}

export async function ensureStore(): Promise<StoreData> {
  let store = await loadStore();
  if (store.orgs.length === 0) {
    store = seedDefaultOrg(emptyStore());
    await saveStore(store);
  }
  return store;
}

export async function withStore<T>(fn: (store: StoreData) => T | Promise<T>): Promise<T> {
  const store = await ensureStore();
  const result = await fn(store);
  await saveStore(store);
  return result;
}

export async function withStoreRead<T>(fn: (store: StoreData) => T | Promise<T>): Promise<T> {
  const store = await ensureStore();
  return fn(store);
}

function requireOrg(store: StoreData, orgId: string): Org {
  const org = store.orgs.find((o) => o.id === orgId);
  if (!org) throw new L10nError(`Organization not found: ${orgId}`, 'ORG_NOT_FOUND', 404);
  return org;
}

export function requireProject(store: StoreData, projectId: string): Project {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) throw new L10nError(`Project not found: ${projectId}`, 'PROJECT_NOT_FOUND', 404);
  return project;
}

function requireKey(store: StoreData, keyId: string): KeySegment {
  const key = store.keys.find((k) => k.id === keyId);
  if (!key) throw new L10nError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND', 404);
  return key;
}

export function requireJob(store: StoreData, jobId: string): Job {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) throw new L10nError(`Job not found: ${jobId}`, 'JOB_NOT_FOUND', 404);
  return job;
}

export function audit(
  store: StoreData,
  orgId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  actorId?: string,
  details?: Record<string, unknown>,
): AuditLog {
  const entry: AuditLog = {
    id: randomUUID(),
    orgId,
    actorId,
    action,
    resourceType,
    resourceId,
    details,
    createdAt: now(),
  };
  store.auditLogs.push(entry);
  return entry;
}

// --- Org & Members ---

export function listOrgs(store: StoreData): Org[] {
  return store.orgs;
}

export function listMembers(store: StoreData, orgId: string): Member[] {
  requireOrg(store, orgId);
  return store.members.filter((m) => m.orgId === orgId);
}

export function inviteMember(
  store: StoreData,
  orgId: string,
  email: string,
  name: string,
  role: Role,
): Member {
  requireOrg(store, orgId);
  const ts = now();
  const member: Member = {
    id: randomUUID(),
    orgId,
    email,
    name,
    role,
    createdAt: ts,
    updatedAt: ts,
  };
  store.members.push(member);
  audit(store, orgId, 'invite_member', 'member', member.id, undefined, { email, role });
  return member;
}

export function registerDevMember(store: StoreData, orgId: string, email: string, name: string): Member {
  return inviteMember(store, orgId, email, name, 'developer');
}

// --- Projects ---

export function listProjects(store: StoreData, orgId: string): Project[] {
  requireOrg(store, orgId);
  return store.projects.filter((p) => p.orgId === orgId);
}

export function getProject(store: StoreData, projectId: string): Project {
  return requireProject(store, projectId);
}

export function createProject(
  store: StoreData,
  orgId: string,
  data: Pick<Project, 'name' | 'slug' | 'sourceLocale' | 'targetLocales'> & {
    description?: string;
    styleGuide?: string;
  },
): Project {
  requireOrg(store, orgId);
  const ts = now();
  const project: Project = {
    id: randomUUID(),
    orgId,
    ...data,
    createdAt: ts,
    updatedAt: ts,
  };
  store.projects.push(project);
  audit(store, orgId, 'create_project', 'project', project.id);
  return project;
}

export function updateProject(
  store: StoreData,
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'styleGuide' | 'targetLocales'>>,
): Project {
  const project = requireProject(store, projectId);
  Object.assign(project, patch, { updatedAt: now() });
  audit(store, project.orgId, 'update_project', 'project', projectId, undefined, patch);
  return project;
}

// --- Resources ---

export function listResources(store: StoreData, projectId: string): Resource[] {
  requireProject(store, projectId);
  return store.resources.filter((r) => r.projectId === projectId);
}

export function upsertResource(
  store: StoreData,
  projectId: string,
  name: string,
  format: Resource['format'],
): Resource {
  const project = requireProject(store, projectId);
  const existing = store.resources.find((r) => r.projectId === projectId && r.name === name);
  const ts = now();
  if (existing) {
    existing.format = format;
    existing.updatedAt = ts;
    return existing;
  }
  const resource: Resource = {
    id: randomUUID(),
    projectId,
    name,
    format,
    createdAt: ts,
    updatedAt: ts,
  };
  store.resources.push(resource);
  audit(store, project.orgId, 'upsert_resource', 'resource', resource.id);
  return resource;
}

// --- Keys ---

export function listKeys(store: StoreData, projectId: string, resourceId?: string): KeySegment[] {
  requireProject(store, projectId);
  return store.keys.filter(
    (k) => k.projectId === projectId && (!resourceId || k.resourceId === resourceId),
  );
}

export function upsertKey(
  store: StoreData,
  projectId: string,
  resourceId: string,
  key: string,
  sourceText: string,
  extras?: Partial<Pick<KeySegment, 'context' | 'maxLength' | 'tags'>>,
): KeySegment {
  const project = requireProject(store, projectId);
  const ts = now();
  const existing = store.keys.find(
    (k) => k.projectId === projectId && k.resourceId === resourceId && k.key === key,
  );
  if (existing) {
    existing.sourceText = sourceText;
    if (extras?.context !== undefined) existing.context = extras.context;
    if (extras?.maxLength !== undefined) existing.maxLength = extras.maxLength;
    if (extras?.tags !== undefined) existing.tags = extras.tags;
    existing.updatedAt = ts;
    return existing;
  }
  const segment: KeySegment = {
    id: randomUUID(),
    projectId,
    resourceId,
    key,
    sourceText,
    context: extras?.context,
    maxLength: extras?.maxLength,
    tags: extras?.tags,
    createdAt: ts,
    updatedAt: ts,
  };
  store.keys.push(segment);
  audit(store, project.orgId, 'upsert_key', 'key', segment.id);
  return segment;
}

export function deleteKey(store: StoreData, keyId: string): void {
  const key = requireKey(store, keyId);
  const project = requireProject(store, key.projectId);
  store.keys = store.keys.filter((k) => k.id !== keyId);
  store.translations = store.translations.filter((t) => t.keyId !== keyId);
  audit(store, project.orgId, 'delete_key', 'key', keyId);
}

export function attachContext(
  store: StoreData,
  keyId: string,
  context: { screenshotUrl?: string; figmaUrl?: string },
): KeySegment {
  const key = requireKey(store, keyId);
  if (context.screenshotUrl !== undefined) key.screenshotUrl = context.screenshotUrl;
  if (context.figmaUrl !== undefined) key.figmaUrl = context.figmaUrl;
  key.updatedAt = now();
  return key;
}

// --- Translations ---

export function listTranslations(
  store: StoreData,
  projectId: string,
  locale?: string,
): Translation[] {
  requireProject(store, projectId);
  return store.translations.filter(
    (t) => t.projectId === projectId && (!locale || t.locale === locale),
  );
}

export function getTranslation(store: StoreData, keyId: string, locale: string): Translation | undefined {
  return store.translations.find((t) => t.keyId === keyId && t.locale === locale);
}

export function updateTranslation(
  store: StoreData,
  keyId: string,
  locale: string,
  text: string,
  status?: TranslationStatus,
  updatedBy?: string,
): Translation {
  const key = requireKey(store, keyId);
  const project = requireProject(store, key.projectId);
  const ts = now();
  let translation = store.translations.find((t) => t.keyId === keyId && t.locale === locale);
  if (translation) {
    translation.text = text;
    if (status) translation.status = status;
    if (updatedBy) translation.updatedBy = updatedBy;
    translation.updatedAt = ts;
  } else {
    translation = {
      id: randomUUID(),
      keyId,
      projectId: key.projectId,
      locale,
      text,
      status: status ?? 'draft',
      updatedBy,
      createdAt: ts,
      updatedAt: ts,
    };
    store.translations.push(translation);
  }
  audit(store, project.orgId, 'update_translation', 'translation', translation.id, updatedBy, {
    keyId,
    locale,
    status: translation.status,
  });
  return translation;
}

export function setTranslationStatus(
  store: StoreData,
  keyId: string,
  locale: string,
  status: TranslationStatus,
): Translation {
  const existing = getTranslation(store, keyId, locale);
  if (!existing) {
    throw new L10nError(`Translation not found for key ${keyId} locale ${locale}`, 'TRANSLATION_NOT_FOUND', 404);
  }
  existing.status = status;
  existing.updatedAt = now();
  return existing;
}

// --- TM ---

export function listTmEntries(
  store: StoreData,
  orgId: string,
  sourceLocale?: string,
  targetLocale?: string,
): TmEntry[] {
  return store.tmEntries.filter(
    (e) =>
      e.orgId === orgId &&
      (!sourceLocale || e.sourceLocale === sourceLocale) &&
      (!targetLocale || e.targetLocale === targetLocale),
  );
}

export function upsertTmEntry(store: StoreData, entry: Omit<TmEntry, 'id' | 'createdAt' | 'updatedAt'>): TmEntry {
  const ts = now();
  const existing = store.tmEntries.find(
    (e) =>
      e.orgId === entry.orgId &&
      e.sourceLocale === entry.sourceLocale &&
      e.targetLocale === entry.targetLocale &&
      e.sourceText === entry.sourceText,
  );
  if (existing) {
    existing.targetText = entry.targetText;
    existing.projectId = entry.projectId;
    existing.keyId = entry.keyId;
    existing.updatedAt = ts;
    return existing;
  }
  const tm: TmEntry = { id: randomUUID(), ...entry, createdAt: ts, updatedAt: ts };
  store.tmEntries.push(tm);
  return tm;
}

// --- Glossary ---

export function listGlossaryTerms(
  store: StoreData,
  orgId: string,
  projectId?: string,
  locale?: string,
): GlossaryTerm[] {
  return store.glossaryTerms.filter(
    (t) =>
      t.orgId === orgId &&
      (!projectId || !t.projectId || t.projectId === projectId) &&
      (!locale || t.locale === locale),
  );
}

export function upsertGlossaryTerm(
  store: StoreData,
  data: Omit<GlossaryTerm, 'id' | 'createdAt' | 'updatedAt'>,
): GlossaryTerm {
  const ts = now();
  const existing = store.glossaryTerms.find(
    (t) =>
      t.orgId === data.orgId &&
      t.term === data.term &&
      t.locale === data.locale &&
      t.projectId === data.projectId,
  );
  if (existing) {
    Object.assign(existing, data, { updatedAt: ts });
    return existing;
  }
  const term: GlossaryTerm = { id: randomUUID(), ...data, createdAt: ts, updatedAt: ts };
  store.glossaryTerms.push(term);
  return term;
}

export function deleteGlossaryTerm(store: StoreData, termId: string): void {
  store.glossaryTerms = store.glossaryTerms.filter((t) => t.id !== termId);
}

// --- Jobs ---

export function createJob(
  store: StoreData,
  data: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'processedCount' | 'errors' | 'retryCount' | 'status'>,
): Job {
  const ts = now();
  const job: Job = {
    id: randomUUID(),
    ...data,
    status: 'pending',
    processedCount: 0,
    errors: [],
    retryCount: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  store.jobs.push(job);
  return job;
}

export function updateJob(store: StoreData, jobId: string, patch: Partial<Job>): Job {
  const job = requireJob(store, jobId);
  Object.assign(job, patch, { updatedAt: now() });
  return job;
}

export function listJobs(store: StoreData, projectId?: string): Job[] {
  return store.jobs.filter((j) => !projectId || j.projectId === projectId);
}

// --- QA Findings ---

export function replaceQaFindings(store: StoreData, projectId: string, locale: string, findings: QaFinding[]): void {
  store.qaFindings = store.qaFindings.filter(
    (f) => !(f.projectId === projectId && f.locale === locale),
  );
  store.qaFindings.push(...findings);
}

export function listQaFindings(store: StoreData, projectId: string, locale?: string): QaFinding[] {
  return store.qaFindings.filter(
    (f) => f.projectId === projectId && (!locale || f.locale === locale),
  );
}

// --- Integrations ---

export function upsertIntegration(
  store: StoreData,
  data: Omit<Integration, 'id' | 'createdAt' | 'updatedAt'>,
): Integration {
  const ts = now();
  const existing = store.integrations.find(
    (i) => i.projectId === data.projectId && i.type === data.type,
  );
  if (existing) {
    existing.config = data.config;
    existing.updatedAt = ts;
    return existing;
  }
  const integration: Integration = { id: randomUUID(), ...data, createdAt: ts, updatedAt: ts };
  store.integrations.push(integration);
  return integration;
}

// --- API Keys ---

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function createApiKeyRecord(
  store: StoreData,
  orgId: string,
  name: string,
  role: Role,
  memberId?: string,
): { record: ApiKey; rawKey: string } {
  requireOrg(store, orgId);
  const rawKey = `zl10n_${randomUUID().replace(/-/g, '')}`;
  const prefix = rawKey.slice(0, 12);
  const record: ApiKey = {
    id: randomUUID(),
    orgId,
    memberId,
    name,
    keyHash: hashApiKey(rawKey),
    prefix,
    role,
    createdAt: now(),
  };
  store.apiKeys.push(record);
  audit(store, orgId, 'create_api_key', 'api_key', record.id);
  return { record, rawKey };
}

export function listApiKeys(store: StoreData, orgId: string): ApiKey[] {
  requireOrg(store, orgId);
  return store.apiKeys.filter((k) => k.orgId === orgId);
}

// --- Billing ---

export function getBillingStatus(store: StoreData, orgId: string): BillingHook | undefined {
  return store.billingHooks.find((b) => b.orgId === orgId);
}

// --- Analytics ---

export function createAnalyticsSnapshot(store: StoreData, orgId: string, projectId?: string): AnalyticsSnapshot {
  const projects = projectId
    ? store.projects.filter((p) => p.id === projectId)
    : store.projects.filter((p) => p.orgId === orgId);

  const projectIds = new Set(projects.map((p) => p.id));
  const keys = store.keys.filter((k) => projectIds.has(k.projectId));
  const translations = store.translations.filter((t) => projectIds.has(t.projectId));
  const qaCount = store.qaFindings.filter((f) => projectIds.has(f.projectId)).length;
  const tmCount = store.tmEntries.filter((e) => e.orgId === orgId).length;

  const byLocale: AnalyticsSnapshot['metrics']['byLocale'] = {};
  for (const t of translations) {
    if (!byLocale[t.locale]) {
      byLocale[t.locale] = { total: 0, approved: 0, published: 0 };
    }
    byLocale[t.locale].total += 1;
    if (t.status === 'approved') byLocale[t.locale].approved += 1;
    if (t.status === 'published') byLocale[t.locale].published += 1;
  }

  const snapshot: AnalyticsSnapshot = {
    id: randomUUID(),
    orgId,
    projectId,
    metrics: {
      totalKeys: keys.length,
      translatedKeys: translations.filter((t) => t.text.trim().length > 0).length,
      approvedKeys: translations.filter((t) => t.status === 'approved' || t.status === 'published').length,
      publishedKeys: translations.filter((t) => t.status === 'published').length,
      qaFindings: qaCount,
      tmEntries: tmCount,
      byLocale,
    },
    createdAt: now(),
  };
  store.analyticsSnapshots.push(snapshot);
  return snapshot;
}

// --- Community ---

export function submitCommunityDraft(
  store: StoreData,
  projectId: string,
  keyId: string,
  locale: string,
  text: string,
  submitterEmail?: string,
): CommunitySubmission {
  requireProject(store, projectId);
  requireKey(store, keyId);
  const submission: CommunitySubmission = {
    id: randomUUID(),
    projectId,
    keyId,
    locale,
    text,
    submitterEmail,
    status: 'pending',
    createdAt: now(),
  };
  store.communitySubmissions.push(submission);
  return submission;
}

export function listCommunitySubmissions(
  store: StoreData,
  projectId: string,
  locale?: string,
): CommunitySubmission[] {
  requireProject(store, projectId);
  return store.communitySubmissions.filter(
    (s) => s.projectId === projectId && (!locale || s.locale === locale),
  );
}
