'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  AnalyticsSnapshot,
  CommunitySubmission,
  GlossaryTerm,
  Job,
  KeySegment,
  Project,
  QaFinding,
  Translation,
  TranslationStatus,
  TmEntry,
} from '@/lib/types';

const API = '/api/zeroai/workspace/l10n';

type LlmBind = {
  base_url?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  models?: { translator?: string; reviewer?: string; qa?: string };
};

const STATUS_COLORS: Record<TranslationStatus, string> = {
  draft: '#94a3b8',
  mt: '#38bdf8',
  in_review: '#fbbf24',
  approved: '#34d399',
  published: '#14b8a6',
};

async function workspace<T = unknown>(payload: Record<string, unknown>, llm?: LlmBind | null): Promise<T> {
  const AI = new Set(['translate_batch', 'review_batch']);
  const inIframe = typeof window !== 'undefined' && window.parent && window.parent !== window;

  // When embedded in ZeroAI, route AI (and optionally all) actions through parent
  // so Market vault cookies + Swarm lineup are used (Legal Research pattern).
  if (inIframe && AI.has(String(payload.action || ''))) {
    return workspaceViaParent<T>(payload);
  }

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...payload, ...(llm?.base_url ? { llm } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Request failed');
  }
  return (data?.result !== undefined ? data.result : data) as T;
}

function workspaceViaParent<T>(payload: Record<string, unknown>): Promise<T> {
  const id = `l10n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('ZeroAI parent timed out — open L10n from ZeroAI Workspace'));
    }, 120_000);

    function onMsg(e: MessageEvent) {
      if (e.data?.type !== 'zerroai:l10n-action-result' || e.data?.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (!e.data.ok) {
        reject(
          new Error(
            e.data?.data?.error ||
              e.data?.data?.detail ||
              'ZeroAI L10n action failed'
          )
        );
        return;
      }
      const data = e.data.data;
      resolve((data?.result !== undefined ? data.result : data) as T);
    }

    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: 'zerroai:l10n-action', id, payload }, '*');
  });
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EmbedClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [locale, setLocale] = useState('');
  const [keys, setKeys] = useState<KeySegment[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TranslationStatus | 'all'>('all');
  const [targetText, setTargetText] = useState('');
  const [importJson, setImportJson] = useState('');
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [tmQuery, setTmQuery] = useState('');
  const [tmResults, setTmResults] = useState<TmEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [qaFindings, setQaFindings] = useState<QaFinding[]>([]);
  const [community, setCommunity] = useState<CommunitySubmission[]>([]);
  const [llmBind, setLlmBind] = useState<LlmBind | null>(null);
  const [showLlmPanel, setShowLlmPanel] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [glossaryTerm, setGlossaryTerm] = useState('');
  const [glossaryTranslation, setGlossaryTranslation] = useState('');
  const [contextUrl, setContextUrl] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const selectedKey = useMemo(() => keys.find((k) => k.id === selectedKeyId) ?? null, [keys, selectedKeyId]);
  const selectedTranslation = useMemo(
    () => translations.find((t) => t.keyId === selectedKeyId && t.locale === locale),
    [translations, selectedKeyId, locale],
  );

  const translationMap = useMemo(() => {
    const map = new Map<string, Translation>();
    for (const t of translations) {
      if (t.locale === locale) map.set(t.keyId, t);
    }
    return map;
  }, [translations, locale]);

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keys.filter((k) => {
      if (q && !k.key.toLowerCase().includes(q) && !k.sourceText.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter === 'all') return true;
      const t = translationMap.get(k.id);
      return (t?.status ?? 'draft') === statusFilter;
    });
  }, [keys, search, statusFilter, translationMap]);

  const refreshProjects = useCallback(async () => {
    const res = await workspace<Project[]>({ action: 'list_projects' });
    const list = Array.isArray(res) ? res : [];
    setProjects(list);
    if (!projectId && list.length) {
      setProjectId(list[0].id);
      setLocale(list[0].targetLocales[0] ?? 'ko');
    }
  }, [projectId]);

  const refreshKeys = useCallback(async () => {
    if (!projectId) return;
    const [keyList, translationList] = await Promise.all([
      workspace<KeySegment[]>({ action: 'list_keys', projectId }),
      workspace<Translation[]>({ action: 'list_translations', projectId, locale }),
    ]);
    setKeys(Array.isArray(keyList) ? keyList : []);
    setTranslations(Array.isArray(translationList) ? translationList : []);
  }, [projectId, locale]);

  const refreshGlossary = useCallback(async () => {
    if (!projectId) return;
    const res = await workspace<GlossaryTerm[]>({
      action: 'list_glossary',
      projectId,
      locale,
    });
    setGlossary(Array.isArray(res) ? res : []);
  }, [projectId, locale]);

  const refreshJobs = useCallback(async () => {
    if (!projectId) return;
    const res = await workspace<Job[]>({ action: 'list_jobs', projectId });
    setJobs(Array.isArray(res) ? res : []);
  }, [projectId]);

  const refreshAnalytics = useCallback(async () => {
    if (!projectId) return;
    const res = await workspace<AnalyticsSnapshot>({
      action: 'analytics_snapshot',
      projectId,
    });
    setAnalytics(res && typeof res === 'object' && 'metrics' in res ? res : null);
  }, [projectId]);

  const refreshCommunity = useCallback(async () => {
    if (!projectId) return;
    const res = await workspace<CommunitySubmission[]>({
      action: 'community_list',
      projectId,
    });
    setCommunity(Array.isArray(res) ? res : []);
  }, [projectId]);

  useEffect(() => {
    refreshProjects().catch((e) => setError(e.message));
  }, [refreshProjects]);

  useEffect(() => {
    if (project) {
      if (!project.targetLocales.includes(locale)) {
        setLocale(project.targetLocales[0] ?? 'ko');
      }
    }
  }, [project, locale]);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      refreshKeys(),
      refreshGlossary(),
      refreshJobs(),
      refreshAnalytics(),
      refreshCommunity(),
    ]).catch((e) => setError(e.message));
  }, [projectId, locale, refreshKeys, refreshGlossary, refreshJobs, refreshAnalytics, refreshCommunity]);

  useEffect(() => {
    setTargetText(selectedTranslation?.text ?? '');
    setContextUrl(selectedKey?.screenshotUrl ?? '');
    setFigmaUrl(selectedKey?.figmaUrl ?? '');
  }, [selectedTranslation, selectedKey]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'zerroai:llm-bind' && e.data.llm) {
        setLlmBind(e.data.llm as LlmBind);
        setNotice('LLM bind received from ZeroAI parent.');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const handleCreateProject = () =>
    run('Creating project…', async () => {
      if (!newProjectName.trim()) throw new Error('Project name required');
      const res = await workspace<Project>({
        action: 'create_project',
        name: newProjectName.trim(),
        sourceLocale: 'en',
        targetLocales: ['ko', 'ja'],
      });
      setNewProjectName('');
      await refreshProjects();
      if (res?.id) {
        setProjectId(res.id);
        setLocale(res.targetLocales[0] ?? 'ko');
      }
      setNotice('Project created.');
    });

  const handleSave = () =>
    run('Saving…', async () => {
      if (!projectId || !selectedKeyId || !locale) return;
      await workspace({
        action: 'update_translation',
        projectId,
        keyId: selectedKeyId,
        locale,
        text: targetText,
      });
      await refreshKeys();
      await refreshAnalytics();
      setNotice('Translation saved.');
    });

  const handleApprove = () =>
    run('Approving…', async () => {
      if (!projectId || !selectedKeyId || !locale) return;
      await workspace({
        action: 'set_status',
        projectId,
        keyId: selectedKeyId,
        locale,
        status: 'approved',
      });
      await refreshKeys();
      await refreshAnalytics();
      setNotice('Translation approved.');
    });

  const handleImport = () =>
    run('Importing…', async () => {
      if (!projectId || !importJson.trim()) throw new Error('Paste JSON to import');
      await workspace({
        action: 'import_file',
        projectId,
        resourceName: 'imported',
        format: 'json',
        content: importJson,
        locale,
      });
      setImportJson('');
      await refreshKeys();
      await refreshAnalytics();
      setNotice('Import complete.');
    });

  const handleExport = () =>
    run('Exporting…', async () => {
      if (!projectId) return;
      const res = await workspace<{ content: string; locale?: string }>({
        action: 'export_file',
        projectId,
        format: 'json',
        locale,
      });
      try {
        downloadJson(`export-${locale}.json`, JSON.parse(res.content));
      } catch {
        downloadJson(`export-${locale}.json`, res.content);
      }
      setNotice('Export downloaded.');
    });

  const handleTranslateBatch = () =>
    run('Translating…', async () => {
      if (!projectId || !locale) return;
      await workspace(
        { action: 'translate_batch', projectId, locale, limit: 50 },
        llmBind,
      );
      await refreshKeys();
      await refreshJobs();
      await refreshAnalytics();
      setNotice('Translate batch finished.');
    });

  const handleReviewBatch = () =>
    run('Reviewing…', async () => {
      if (!projectId || !locale) return;
      await workspace({ action: 'review_batch', projectId, locale, limit: 50 }, llmBind);
      await refreshKeys();
      await refreshJobs();
      await refreshAnalytics();
      setNotice('Review batch finished.');
    });

  const handleRunQa = () =>
    run('Running QA…', async () => {
      if (!projectId || !locale) return;
      const res = await workspace<QaFinding[]>({
        action: 'run_qa',
        projectId,
        locale,
      });
      setQaFindings(Array.isArray(res) ? res : []);
      await refreshAnalytics();
      setNotice(`QA complete — ${Array.isArray(res) ? res.length : 0} findings.`);
    });

  const handleTmSearch = () =>
    run('Searching TM…', async () => {
      if (!projectId || !tmQuery.trim()) return;
      const res = await workspace<Array<{ entry: TmEntry; score: number }>>({
        action: 'search_tm',
        projectId,
        query: tmQuery,
        sourceLocale: project?.sourceLocale ?? 'en',
        targetLocale: locale,
      });
      setTmResults(Array.isArray(res) ? res.map((m) => m.entry) : []);
    });

  const handleAddGlossary = () =>
    run('Adding term…', async () => {
      if (!glossaryTerm.trim()) throw new Error('Term required');
      await workspace({
        action: 'upsert_glossary',
        projectId,
        term: glossaryTerm.trim(),
        locale,
        translation: glossaryTranslation.trim() || undefined,
        preferred: true,
      });
      setGlossaryTerm('');
      setGlossaryTranslation('');
      await refreshGlossary();
      setNotice('Glossary term saved.');
    });

  const handleAttachContext = () =>
    run('Attaching context…', async () => {
      if (!selectedKeyId) return;
      await workspace({
        action: 'attach_context',
        keyId: selectedKeyId,
        screenshotUrl: contextUrl || undefined,
        figmaUrl: figmaUrl || undefined,
      });
      await refreshKeys();
      setNotice('Context attached.');
    });

  const statusBadge = (status: TranslationStatus) => (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '0.15rem 0.45rem',
        borderRadius: 4,
        background: `${STATUS_COLORS[status]}22`,
        color: STATUS_COLORS[status],
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
        }}
      >
        <strong style={{ color: 'var(--teal)', fontSize: '1.1rem' }}>Zerro L10n</strong>

        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          style={selectStyle}
        >
          <option value="">Select project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <input
          placeholder="New project name"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          style={{ ...inputStyle, width: 160 }}
        />
        <button type="button" onClick={handleCreateProject} style={btnPrimary} disabled={!!busy}>
          Create
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {project?.targetLocales.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setLocale(loc)}
              style={{
                ...btnGhost,
                background: locale === loc ? 'var(--teal-glow)' : 'transparent',
                borderColor: locale === loc ? 'var(--teal)' : 'var(--border)',
              }}
            >
              {loc}
            </button>
          ))}
          <button type="button" onClick={() => setShowLlmPanel((v) => !v)} style={btnGhost}>
            {llmBind?.base_url ? 'LLM ✓' : 'LLM'}
          </button>
        </div>
      </header>

      {/* Analytics strip */}
      {analytics && (
        <div
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: '1.5rem',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Keys: <strong style={{ color: 'var(--text)' }}>{analytics.metrics.totalKeys}</strong>
          </span>
          <span>
            Translated:{' '}
            <strong style={{ color: 'var(--text)' }}>{analytics.metrics.translatedKeys}</strong>
          </span>
          <span>
            Approved:{' '}
            <strong style={{ color: 'var(--success)' }}>{analytics.metrics.approvedKeys}</strong>
          </span>
          <span>
            TM entries:{' '}
            <strong style={{ color: 'var(--text)' }}>{analytics.metrics.tmEntries}</strong>
          </span>
          <span>
            QA open:{' '}
            <strong style={{ color: 'var(--warning)' }}>{analytics.metrics.qaFindings}</strong>
          </span>
        </div>
      )}

      {(error || notice || busy) && (
        <div
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            background: error ? 'rgba(248,113,113,0.1)' : 'var(--teal-glow)',
            color: error ? 'var(--danger)' : 'var(--teal)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {error || busy || notice}
        </div>
      )}

      {showLlmPanel && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.5rem',
          }}
        >
          <input
            placeholder="LLM base URL (OpenAI-compatible)"
            value={llmBind?.base_url ?? ''}
            onChange={(e) => setLlmBind((b) => ({ ...b, base_url: e.target.value }))}
            style={inputStyle}
          />
          <input
            placeholder="API key (optional)"
            type="password"
            value={llmBind?.api_key ?? ''}
            onChange={(e) => setLlmBind((b) => ({ ...b, api_key: e.target.value }))}
            style={inputStyle}
          />
          <input
            placeholder="Default model"
            value={llmBind?.model ?? ''}
            onChange={(e) => setLlmBind((b) => ({ ...b, model: e.target.value }))}
            style={inputStyle}
          />
        </div>
      )}

      {/* Main grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr 300px', minHeight: 0 }}>
        {/* Key list */}
        <aside
          style={{
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
          }}
        >
          <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
            <input
              placeholder="Search keys…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: '0.5rem' }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TranslationStatus | 'all')}
              style={{ ...selectStyle, width: '100%' }}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="mt">MT</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
            </select>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filteredKeys.map((k) => {
              const t = translationMap.get(k.id);
              const active = k.id === selectedKeyId;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setSelectedKeyId(k.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.6rem 0.75rem',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    background: active ? 'var(--teal-glow)' : 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    className="mono"
                    style={{ fontSize: '0.75rem', color: 'var(--teal)', marginBottom: 2 }}
                  >
                    {k.key}
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {k.sourceText}
                  </div>
                  <div style={{ marginTop: 4 }}>{statusBadge(t?.status ?? 'draft')}</div>
                </button>
              );
            })}
            {!filteredKeys.length && (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                No keys — import JSON or use the demo project.
              </p>
            )}
          </div>
        </aside>

        {/* Editor */}
        <main style={{ padding: '1rem', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {selectedKey ? (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <code style={{ color: 'var(--teal)', fontSize: '0.85rem' }}>{selectedKey.key}</code>
                  {selectedTranslation && statusBadge(selectedTranslation.status)}
                </div>
                <label style={labelStyle}>Source ({project?.sourceLocale})</label>
                <textarea
                  readOnly
                  value={selectedKey.sourceText}
                  style={{ ...textareaStyle, opacity: 0.85, minHeight: 80 }}
                />
              </div>
              <div>
                <label style={labelStyle}>Target ({locale})</label>
                <textarea
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  style={{ ...textareaStyle, minHeight: 120 }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSave} style={btnPrimary} disabled={!!busy}>
                  Save
                </button>
                <button type="button" onClick={handleApprove} style={btnGhost} disabled={!!busy}>
                  Approve
                </button>
                <button type="button" onClick={handleTranslateBatch} style={btnGhost} disabled={!!busy}>
                  AI Translate batch
                </button>
                <button type="button" onClick={handleReviewBatch} style={btnGhost} disabled={!!busy}>
                  Review batch
                </button>
                <button type="button" onClick={handleRunQa} style={btnGhost} disabled={!!busy}>
                  Run QA
                </button>
              </div>

              <section>
                <label style={labelStyle}>Import JSON</label>
                <textarea
                  placeholder='{"app.title": "Hello"}'
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  style={{ ...textareaStyle, minHeight: 70, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="button" onClick={handleImport} style={btnGhost} disabled={!!busy}>
                    Import
                  </button>
                  <button type="button" onClick={handleExport} style={btnGhost} disabled={!!busy}>
                    Export download
                  </button>
                </div>
              </section>

              <section>
                <label style={labelStyle}>Visual context</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <input
                    placeholder="Screenshot URL"
                    value={contextUrl}
                    onChange={(e) => setContextUrl(e.target.value)}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Figma URL"
                    value={figmaUrl}
                    onChange={(e) => setFigmaUrl(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAttachContext}
                  style={{ ...btnGhost, marginTop: '0.5rem' }}
                  disabled={!!busy}
                >
                  Attach context
                </button>
                {(selectedKey.screenshotUrl || selectedKey.figmaUrl) && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {selectedKey.screenshotUrl && (
                      <a href={selectedKey.screenshotUrl} target="_blank" rel="noreferrer">
                        Screenshot
                      </a>
                    )}
                    {selectedKey.figmaUrl && (
                      <>
                        {' · '}
                        <a href={selectedKey.figmaUrl} target="_blank" rel="noreferrer">
                          Figma
                        </a>
                      </>
                    )}
                  </div>
                )}
              </section>

              {qaFindings.length > 0 && (
                <section>
                  <label style={labelStyle}>QA findings ({qaFindings.length})</label>
                  <ul style={{ margin: 0, padding: '0 0 0 1rem', fontSize: '0.85rem' }}>
                    {qaFindings.slice(0, 8).map((f) => (
                      <li key={f.id} style={{ color: f.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>
                        [{f.rule}] {f.message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center' }}>
              Select a key from the list to edit translations.
            </div>
          )}
        </main>

        {/* Side panels */}
        <aside
          style={{
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'auto',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <section>
            <h3 style={panelTitle}>Glossary</h3>
            <input
              placeholder="Term"
              value={glossaryTerm}
              onChange={(e) => setGlossaryTerm(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
            />
            <input
              placeholder="Translation"
              value={glossaryTranslation}
              onChange={(e) => setGlossaryTranslation(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
            />
            <button type="button" onClick={handleAddGlossary} style={{ ...btnGhost, width: '100%' }} disabled={!!busy}>
              Add term
            </button>
            <ul style={{ margin: '0.5rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.8rem' }}>
              {glossary.slice(0, 12).map((g) => (
                <li key={g.id} style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                  <strong>{g.term}</strong>
                  {g.translation && <span style={{ color: 'var(--muted)' }}> → {g.translation}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 style={panelTitle}>TM search</h3>
            <input
              placeholder="Source text…"
              value={tmQuery}
              onChange={(e) => setTmQuery(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
            />
            <button type="button" onClick={handleTmSearch} style={{ ...btnGhost, width: '100%' }} disabled={!!busy}>
              Search
            </button>
            <ul style={{ margin: '0.5rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.78rem' }}>
              {tmResults.map((hit) => (
                <li key={hit.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--muted)' }}>{hit.sourceText}</div>
                  <div style={{ color: 'var(--teal)' }}>{hit.targetText}</div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 style={panelTitle}>Jobs</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.78rem' }}>
              {jobs.slice(0, 8).map((j) => (
                <li key={j.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong>{j.type}</strong>{' '}
                    <span style={{ color: j.status === 'completed' ? 'var(--success)' : 'var(--muted)' }}>
                      {j.status}
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)' }}>
                    {j.processedCount}/{j.totalCount}
                    {j.errors.length > 0 && ` · ${j.errors.length} errors`}
                  </div>
                </li>
              ))}
              {!jobs.length && <li style={{ color: 'var(--muted)' }}>No jobs yet</li>}
            </ul>
          </section>

          <section>
            <h3 style={panelTitle}>Community</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.78rem' }}>
              {community.slice(0, 6).map((s) => (
                <li key={s.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--muted)' }}>{s.locale}</div>
                  <div>{s.text.slice(0, 80)}</div>
                  <div style={{ color: 'var(--teal)', fontSize: '0.7rem' }}>{s.status}</div>
                </li>
              ))}
              {!community.length && <li style={{ color: 'var(--muted)' }}>No submissions</li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: '0.45rem 0.6rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  width: '100%',
  resize: 'vertical',
  lineHeight: 1.5,
};

const btnPrimary: CSSProperties = {
  padding: '0.45rem 0.9rem',
  background: 'var(--teal)',
  color: '#042f2e',
  border: 'none',
  borderRadius: 6,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: CSSProperties = {
  padding: '0.45rem 0.75rem',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: 'var(--muted)',
  marginBottom: '0.35rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const panelTitle: CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.8rem',
  color: 'var(--teal)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
