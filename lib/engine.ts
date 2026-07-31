import {
  buildGlossaryPromptBlock,
  deleteTerm,
  listTerms,
  upsertTerm,
} from './glossary';
import {
  buildReviewPrompt,
  buildTranslatePrompt,
  parseReviewResult,
} from './agents';
import {
  exportFileContent,
  parseFileContent,
  type ImportFormat,
} from './formats';
import { getPluginManifest } from './manifest';
import { runQa } from './qa';
import {
  attachContext,
  createAnalyticsSnapshot,
  createApiKeyRecord,
  createJob,
  createProject,
  deleteKey,
  ensureStore,
  getBillingStatus,
  getProject,
  getTranslation,
  inviteMember,
  listApiKeys,
  listCommunitySubmissions,
  listJobs,
  listKeys,
  listMembers,
  listProjects,
  listQaFindings,
  listResources,
  listTranslations,
  registerDevMember,
  requireJob,
  requireProject,
  saveStore,
  setTranslationStatus,
  submitCommunityDraft,
  updateJob,
  updateProject,
  updateTranslation,
  upsertKey,
  upsertIntegration,
  upsertResource,
  withStore,
} from './store';
import { exactMatch, fuzzyMatch, searchTm, upsertTmFromApproved } from './tm';
import type {
  Job,
  KeySegment,
  TranslationStatus,
  WorkspaceActionRequest,
} from './types';
import { L10nError } from './types';

export interface HandleWorkspaceActionOpts {
  completeChat?: (messages: Array<{ role: string; content: string }>, role: string) => Promise<string>;
}

const DEFAULT_ORG = 'default';

function resolveOrgId(body: WorkspaceActionRequest): string {
  return (body.orgId as string | undefined) ?? DEFAULT_ORG;
}

async function runTranslateBatch(
  store: Awaited<ReturnType<typeof ensureStore>>,
  body: WorkspaceActionRequest,
  opts?: HandleWorkspaceActionOpts,
): Promise<{ job: Job; translations: unknown[] }> {
  const projectId = body.projectId as string;
  const locale = body.locale as string;
  const limit = (body.limit as number | undefined) ?? 50;
  const keyIds = body.keyIds as string[] | undefined;

  const project = requireProject(store, projectId);
  if (!project.targetLocales.includes(locale)) {
    throw new L10nError(`Locale ${locale} is not a target locale for this project`, 'INVALID_LOCALE');
  }

  let keys = listKeys(store, projectId);
  if (keyIds?.length) {
    keys = keys.filter((k) => keyIds.includes(k.id));
  }
  keys = keys.slice(0, limit);

  const job = createJob(store, {
    orgId: project.orgId,
    projectId,
    type: 'translate_batch',
    locale,
    keyIds: keys.map((k) => k.id),
    totalCount: keys.length,
    retryBudget: 3,
    metadata: { locale },
  });

  job.status = 'running';
  const glossaryTerms = listTerms(store, project.orgId, projectId, locale);
  const glossaryBlock = buildGlossaryPromptBlock(glossaryTerms, locale);
  const results: unknown[] = [];

  for (const key of keys) {
    try {
      const existing = getTranslation(store, key.id, locale);
      if (existing && (existing.status === 'approved' || existing.status === 'published')) {
        job.processedCount += 1;
        results.push({ keyId: key.id, skipped: true, status: existing.status });
        continue;
      }

      let translatedText: string | undefined;

      const tmExact = exactMatch(
        store,
        key.sourceText,
        project.sourceLocale,
        locale,
        project.orgId,
      );
      if (tmExact) {
        translatedText = tmExact.targetText;
      } else {
        const tmFuzzy = fuzzyMatch(
          store,
          key.sourceText,
          project.sourceLocale,
          locale,
          project.orgId,
        );

        if (opts?.completeChat) {
          const prompt = buildTranslatePrompt({
            source: key.sourceText,
            sourceLocale: project.sourceLocale,
            targetLocale: locale,
            glossaryBlock,
            tmHits: tmFuzzy,
            styleGuide: project.styleGuide,
            context: key.context,
          });
          translatedText = (await opts.completeChat([{ role: 'user', content: prompt }], 'translator')).trim();
        } else if (tmFuzzy.length > 0) {
          translatedText = tmFuzzy[0].entry.targetText;
        } else {
          throw new L10nError('No TM match and completeChat not provided', 'NO_TRANSLATOR');
        }
      }

      const translation = updateTranslation(store, key.id, locale, translatedText, 'mt');
      results.push({ keyId: key.id, text: translation.text, status: translation.status, source: tmExact ? 'tm' : 'llm' });
      job.processedCount += 1;
    } catch (err) {
      job.errors.push({
        keyId: key.id,
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
      job.processedCount += 1;
    }
    job.updatedAt = new Date().toISOString();
  }

  job.status = job.errors.length === 0 ? 'completed' : job.errors.length === keys.length ? 'failed' : 'partial';
  job.completedAt = new Date().toISOString();
  return { job, translations: results };
}

async function runReviewBatch(
  store: Awaited<ReturnType<typeof ensureStore>>,
  body: WorkspaceActionRequest,
  opts?: HandleWorkspaceActionOpts,
): Promise<{ job: Job; reviews: unknown[] }> {
  const projectId = body.projectId as string;
  const locale = body.locale as string;
  const limit = (body.limit as number | undefined) ?? 50;
  const keyIds = body.keyIds as string[] | undefined;

  const project = requireProject(store, projectId);
  let keys = listKeys(store, projectId);
  if (keyIds?.length) {
    keys = keys.filter((k) => keyIds.includes(k.id));
  }
  keys = keys.slice(0, limit);

  const job = createJob(store, {
    orgId: project.orgId,
    projectId,
    type: 'review_batch',
    locale,
    keyIds: keys.map((k) => k.id),
    totalCount: keys.length,
    retryBudget: 3,
  });
  job.status = 'running';

  const glossaryTerms = listTerms(store, project.orgId, projectId, locale);
  const glossaryBlock = buildGlossaryPromptBlock(glossaryTerms, locale);
  const reviews: unknown[] = [];

  for (const key of keys) {
    try {
      const translation = getTranslation(store, key.id, locale);
      if (!translation?.text.trim()) {
        job.errors.push({ keyId: key.id, message: 'No translation to review', at: new Date().toISOString() });
        job.processedCount += 1;
        continue;
      }

      let approved = false;
      let finalText = translation.text;

      if (opts?.completeChat) {
        const prompt = buildReviewPrompt({
          source: key.sourceText,
          target: translation.text,
          sourceLocale: project.sourceLocale,
          targetLocale: locale,
          glossaryBlock,
          styleGuide: project.styleGuide,
          context: key.context,
        });
        const response = await opts.completeChat([{ role: 'user', content: prompt }], 'reviewer');
        const review = parseReviewResult(response);
        approved = review.approved;
        if (review.revised) finalText = review.revised;
        reviews.push({ keyId: key.id, approved, notes: review.notes });
      } else {
        approved = translation.text.length > 0;
        reviews.push({ keyId: key.id, approved, notes: 'Auto-approved (no reviewer agent)' });
      }

      const status: TranslationStatus = approved ? 'approved' : 'in_review';
      updateTranslation(store, key.id, locale, finalText, status);
      if (approved) {
        const updated = getTranslation(store, key.id, locale)!;
        upsertTmFromApproved(store, updated, key.sourceText, project.orgId, project.sourceLocale);
      }
      job.processedCount += 1;
    } catch (err) {
      job.errors.push({
        keyId: key.id,
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
      job.processedCount += 1;
    }
  }

  job.status = job.errors.length === 0 ? 'completed' : job.errors.length === keys.length ? 'failed' : 'partial';
  job.completedAt = new Date().toISOString();
  return { job, reviews };
}

async function retryJob(
  store: Awaited<ReturnType<typeof ensureStore>>,
  jobId: string,
  opts?: HandleWorkspaceActionOpts,
): Promise<{ job: Job; result: unknown }> {
  const job = requireJob(store, jobId);
  if (job.retryCount >= job.retryBudget) {
    throw new L10nError('Retry budget exhausted', 'RETRY_EXHAUSTED', 429);
  }

  job.retryCount += 1;
  job.errors = [];
  job.processedCount = 0;
  job.status = 'running';
  job.completedAt = undefined;

  const failedKeyIds =
    job.errors.length > 0 ? [...new Set(job.errors.map((e) => e.keyId))] : job.keyIds;
  const body: WorkspaceActionRequest = {
    action: job.type === 'review_batch' ? 'review_batch' : 'translate_batch',
    projectId: job.projectId,
    locale: job.locale,
    keyIds: failedKeyIds,
  };

  if (job.type === 'review_batch') {
    const result = await runReviewBatch(store, body, opts);
    Object.assign(job, result.job);
    return { job, result: result.reviews };
  }

  const result = await runTranslateBatch(store, body, opts);
  Object.assign(job, result.job);
  return { job, result: result.translations };
}

function buildExportFlat(
  store: Awaited<ReturnType<typeof ensureStore>>,
  projectId: string,
  locale: string,
  resourceName?: string,
): Record<string, string> {
  const project = requireProject(store, projectId);
  const keys = listKeys(store, projectId);
  const translations = listTranslations(store, projectId, locale);
  const flat: Record<string, string> = {};

  for (const key of keys) {
    if (resourceName) {
      const resources = listResources(store, projectId);
      const resource = resources.find((r) => r.name === resourceName);
      if (resource && key.resourceId !== resource.id) continue;
    }
    if (locale === project.sourceLocale) {
      flat[key.key] = key.sourceText ?? '';
      continue;
    }
    const t = translations.find((tr) => tr.keyId === key.id);
    flat[key.key] = t?.text ?? '';
  }
  return flat;
}

export async function handleWorkspaceAction(
  body: WorkspaceActionRequest,
  opts?: HandleWorkspaceActionOpts,
): Promise<unknown> {
  const { action } = body;
  const orgId = resolveOrgId(body);

  switch (action) {
    case 'list_projects':
      return withStore((store) => listProjects(store, orgId));

    case 'create_project':
      return withStore((store) =>
        createProject(store, orgId, {
          name: body.name as string,
          slug: body.slug as string,
          sourceLocale: body.sourceLocale as string,
          targetLocales: body.targetLocales as string[],
          description: body.description as string | undefined,
          styleGuide: body.styleGuide as string | undefined,
        }),
      );

    case 'get_project':
      return withStore((store) => getProject(store, body.projectId as string));

    case 'update_project':
      return withStore((store) =>
        updateProject(store, body.projectId as string, {
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          styleGuide: body.styleGuide as string | undefined,
          targetLocales: body.targetLocales as string[] | undefined,
        }),
      );

    case 'list_keys':
      return withStore((store) =>
        listKeys(store, body.projectId as string, body.resourceId as string | undefined),
      );

    case 'upsert_key':
      return withStore((store) =>
        upsertKey(
          store,
          body.projectId as string,
          body.resourceId as string,
          body.key as string,
          body.sourceText as string,
          {
            context: body.context as string | undefined,
            maxLength: body.maxLength as number | undefined,
            tags: body.tags as string[] | undefined,
          },
        ),
      );

    case 'delete_key':
      return withStore((store) => {
        deleteKey(store, body.keyId as string);
        return { ok: true };
      });

    case 'list_translations':
      return withStore((store) =>
        listTranslations(store, body.projectId as string, body.locale as string | undefined),
      );

    case 'update_translation':
      return withStore((store) =>
        updateTranslation(
          store,
          body.keyId as string,
          body.locale as string,
          body.text as string,
          body.status as TranslationStatus | undefined,
          body.updatedBy as string | undefined,
        ),
      );

    case 'set_status':
      return withStore((store) =>
        setTranslationStatus(
          store,
          body.keyId as string,
          body.locale as string,
          body.status as TranslationStatus,
        ),
      );

    case 'import_file': {
      return withStore((store) => {
        const projectId = body.projectId as string;
        const resourceName = body.resourceName as string;
        const format = body.format as ImportFormat;
        const content = body.content as string;
        const locale = (body.locale as string | undefined) ?? requireProject(store, projectId).sourceLocale;

        const project = requireProject(store, projectId);
        const resource = upsertResource(store, projectId, resourceName, format);
        const flat = parseFileContent(format, content);
        const imported: KeySegment[] = [];

        for (const [key, text] of Object.entries(flat)) {
          if (locale === project.sourceLocale) {
            imported.push(upsertKey(store, projectId, resource.id, key, text));
          } else {
            const existing = listKeys(store, projectId).find(
              (k) => k.resourceId === resource.id && k.key === key,
            );
            if (existing) {
              updateTranslation(store, existing.id, locale, text, 'draft');
            } else {
              const segment = upsertKey(store, projectId, resource.id, key, key);
              updateTranslation(store, segment.id, locale, text, 'draft');
            }
          }
        }

        return { resource, importedCount: imported.length, keys: Object.keys(flat).length };
      });
    }

    case 'export_file': {
      return withStore((store) => {
        const projectId = body.projectId as string;
        const format = body.format as ImportFormat;
        const locale = body.locale as string;
        const resourceName = body.resourceName as string | undefined;
        const project = requireProject(store, projectId);

        const flat = buildExportFlat(store, projectId, locale, resourceName);
        const content = exportFileContent(format, flat, {
          nested: true,
          locale,
          projectName: project.name,
        });
        return { content, format, locale, keyCount: Object.keys(flat).length };
      });
    }

    case 'translate_batch':
      return withStore(async (store) => runTranslateBatch(store, body, opts));

    case 'review_batch':
      return withStore(async (store) => runReviewBatch(store, body, opts));

    case 'run_qa':
      return withStore((store) => runQa(store, body.projectId as string, body.locale as string));

    case 'search_tm':
      return withStore((store) => {
        const project = getProject(store, body.projectId as string);
        return searchTm(
          store,
          body.query as string,
          project.orgId,
          body.sourceLocale as string | undefined ?? project.sourceLocale,
          body.targetLocale as string | undefined,
          (body.limit as number | undefined) ?? 10,
        );
      });

    case 'upsert_glossary':
      return withStore((store) =>
        upsertTerm(store, {
          orgId,
          projectId: body.projectId as string | undefined,
          term: body.term as string,
          locale: body.locale as string,
          translation: body.translation as string | undefined,
          definition: body.definition as string | undefined,
          preferred: (body.preferred as boolean | undefined) ?? false,
          forbidden: (body.forbidden as boolean | undefined) ?? false,
          caseSensitive: (body.caseSensitive as boolean | undefined) ?? false,
        }),
      );

    case 'list_glossary':
      return withStore((store) =>
        listTerms(store, orgId, body.projectId as string | undefined, body.locale as string | undefined),
      );

    case 'sync_git': {
      return withStore((store) => {
        const projectId = body.projectId as string;
        const project = requireProject(store, projectId);
        const repo = body.repo as string;
        const branch = (body.branch as string | undefined) ?? 'main';
        const filePath = body.path as string;
        const token = body.token as string | undefined;

        const integration = upsertIntegration(store, {
          orgId: project.orgId,
          projectId,
          type: 'git',
          config: { repo, branch, path: filePath, token: token ? '[redacted]' : undefined },
        });

        const plannedFiles: string[] = [];
        for (const locale of project.targetLocales) {
          plannedFiles.push(`${filePath}/${locale}.json`);
        }
        plannedFiles.push(`${filePath}/${project.sourceLocale}.json`);

        return {
          integration,
          planned: plannedFiles,
          message: 'Git sync stub — integration recorded, files planned from export',
        };
      });
    }

    case 'open_pr': {
      return withStore((store) => {
        const projectId = body.projectId as string;
        const project = requireProject(store, projectId);
        const locale = body.locale as string;
        const flat = buildExportFlat(store, projectId, locale);
        const approved = Object.entries(flat).filter(([key]) => {
          const k = listKeys(store, projectId).find((seg) => seg.key === key);
          if (!k) return false;
          const t = getTranslation(store, k.id, locale);
          return t?.status === 'approved' || t?.status === 'published';
        });

        return {
          title: `chore(l10n): update ${locale} translations for ${project.name}`,
          body: `Automated localization PR with ${approved.length} approved strings.`,
          branch: `l10n/${locale}-${Date.now()}`,
          files: Object.fromEntries(approved),
          status: 'stub',
        };
      });
    }

    case 'attach_context':
      return withStore((store) =>
        attachContext(store, body.keyId as string, {
          screenshotUrl: body.screenshotUrl as string | undefined,
          figmaUrl: body.figmaUrl as string | undefined,
        }),
      );

    case 'list_jobs':
      return withStore((store) => listJobs(store, body.projectId as string | undefined));

    case 'get_job':
      return withStore((store) => requireJob(store, body.jobId as string));

    case 'retry_job':
      return withStore(async (store) => retryJob(store, body.jobId as string, opts));

    case 'auth_register_dev':
      return withStore((store) =>
        registerDevMember(store, orgId, body.email as string, body.name as string),
      );

    case 'list_members':
      return withStore((store) => listMembers(store, orgId));

    case 'invite_member':
      return withStore((store) =>
        inviteMember(
          store,
          orgId,
          body.email as string,
          body.name as string,
          body.role as import('./types').Role,
        ),
      );

    case 'create_api_key':
      return withStore((store) => {
        const { record, rawKey } = createApiKeyRecord(
          store,
          orgId,
          (body.name as string) || 'default',
          (body.role as import('./types').Role) || 'developer',
          body.memberId as string | undefined,
        );
        return { apiKey: record, key: rawKey };
      });

    case 'list_api_keys':
      return withStore((store) => listApiKeys(store, orgId));

    case 'billing_status':
      return withStore((store) => {
        const billing = getBillingStatus(store, orgId);
        return (
          billing ?? {
            provider: 'stripe',
            status: 'trial',
            plan: 'starter',
            seats: 5,
            message: 'Placeholder billing — connect Stripe for production',
          }
        );
      });

    case 'analytics_snapshot':
      return withStore((store) =>
        createAnalyticsSnapshot(store, orgId, body.projectId as string | undefined),
      );

    case 'ota_bundle':
      return withStore((store) => {
        const projectId = body.projectId as string;
        const locale = body.locale as string;
        const keys = listKeys(store, projectId);
        const translations = listTranslations(store, projectId, locale);
        const bundle: Record<string, string> = {};

        for (const key of keys) {
          const t = translations.find((tr) => tr.keyId === key.id);
          if (t && (t.status === 'approved' || t.status === 'published') && t.text.trim()) {
            bundle[key.key] = t.text;
          }
        }

        return {
          projectId,
          locale,
          version: Date.now(),
          strings: bundle,
          count: Object.keys(bundle).length,
        };
      });

    case 'community_submit':
      return withStore((store) =>
        submitCommunityDraft(
          store,
          body.projectId as string,
          body.keyId as string,
          body.locale as string,
          body.text as string,
          body.submitterEmail as string | undefined,
        ),
      );

    case 'community_list':
      return withStore((store) =>
        listCommunitySubmissions(
          store,
          body.projectId as string,
          body.locale as string | undefined,
        ),
      );

    default:
      throw new L10nError(`Unknown action: ${action}`, 'UNKNOWN_ACTION', 400);
  }
}

export type { WorkspaceActionRequest };
