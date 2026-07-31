export type Role = 'owner' | 'manager' | 'translator' | 'reviewer' | 'developer';

export type TranslationStatus = 'draft' | 'mt' | 'in_review' | 'approved' | 'published';

export interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  sourceLocale: string;
  targetLocales: string[];
  description?: string;
  styleGuide?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  projectId: string;
  name: string;
  format: 'json' | 'yaml' | 'po' | 'markdown';
  createdAt: string;
  updatedAt: string;
}

export interface KeySegment {
  id: string;
  projectId: string;
  resourceId: string;
  key: string;
  sourceText: string;
  context?: string;
  maxLength?: number;
  screenshotUrl?: string;
  figmaUrl?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Translation {
  id: string;
  keyId: string;
  projectId: string;
  locale: string;
  text: string;
  status: TranslationStatus;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TmEntry {
  id: string;
  orgId: string;
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  targetText: string;
  projectId?: string;
  keyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTerm {
  id: string;
  orgId: string;
  projectId?: string;
  term: string;
  locale: string;
  translation?: string;
  definition?: string;
  preferred: boolean;
  forbidden: boolean;
  caseSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface JobError {
  keyId: string;
  message: string;
  at: string;
}

export interface Job {
  id: string;
  orgId: string;
  projectId: string;
  type: 'translate_batch' | 'review_batch' | 'import' | 'export' | 'sync_git' | 'qa';
  status: JobStatus;
  locale?: string;
  keyIds: string[];
  processedCount: number;
  totalCount: number;
  errors: JobError[];
  retryBudget: number;
  retryCount: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type QaSeverity = 'error' | 'warning' | 'info';

export interface QaFinding {
  id: string;
  projectId: string;
  keyId: string;
  locale: string;
  rule: string;
  severity: QaSeverity;
  message: string;
  createdAt: string;
}

export interface Integration {
  id: string;
  orgId: string;
  projectId: string;
  type: 'git' | 'figma' | 'slack' | 'webhook';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  orgId: string;
  memberId?: string;
  name: string;
  keyHash: string;
  prefix: string;
  role: Role;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface BillingHook {
  id: string;
  orgId: string;
  provider: 'stripe';
  status: 'trial' | 'active' | 'past_due' | 'canceled';
  plan: string;
  seats: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSnapshot {
  id: string;
  orgId: string;
  projectId?: string;
  metrics: {
    totalKeys: number;
    translatedKeys: number;
    approvedKeys: number;
    publishedKeys: number;
    qaFindings: number;
    tmEntries: number;
    byLocale: Record<string, { total: number; approved: number; published: number }>;
  };
  createdAt: string;
}

export interface CommunitySubmission {
  id: string;
  projectId: string;
  keyId: string;
  locale: string;
  text: string;
  submitterEmail?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface L10nPluginManifest {
  id: string;
  name: string;
  domain: string;
  version: string;
  description?: string;
  capabilities: string[];
  entry: string;
  architecture?: string[];
  uiUrl?: string;
  actions?: string[];
  bindings?: {
    llm: L10nLlmBind;
    agents: L10nAgentModels;
  };
}

export interface L10nLlmBind {
  provider: string;
  model: string;
  temperature?: number;
}

export interface L10nAgentModels {
  translator: string;
  reviewer: string;
  qa: string;
}

export interface WorkspaceActionRequest {
  action: string;
  orgId?: string;
  projectId?: string;
  [key: string]: unknown;
}

export interface StoreData {
  orgs: Org[];
  members: Member[];
  projects: Project[];
  resources: Resource[];
  keys: KeySegment[];
  translations: Translation[];
  tmEntries: TmEntry[];
  glossaryTerms: GlossaryTerm[];
  jobs: Job[];
  qaFindings: QaFinding[];
  integrations: Integration[];
  apiKeys: ApiKey[];
  auditLogs: AuditLog[];
  billingHooks: BillingHook[];
  analyticsSnapshots: AnalyticsSnapshot[];
  communitySubmissions: CommunitySubmission[];
}

export class L10nError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'L10N_ERROR',
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'L10nError';
  }
}
