import type { L10nPluginManifest } from './types';

export function getPluginManifest(): L10nPluginManifest {
  return {
    id: 'zerro-l10n',
    name: 'Localization',
    domain: 'localization',
    version: '0.1.0',
    description:
      'AI-native TMS — catalog, TM, glossary, QA, Git sync, Figma context, OTA',
    capabilities: [
      'catalog',
      'tm',
      'glossary',
      'qa',
      'git_sync',
      'figma',
      'ai_translate',
      'ai_review',
      'ota',
      'community',
    ],
    entry: '/api/zeroai/workspace/l10n',
    architecture: ['catalog', 'tm', 'glossary', 'qa', 'agents', 'ota'],
    uiUrl: '/embed',
    actions: [
      'list_projects',
      'create_project',
      'get_project',
      'update_project',
      'list_keys',
      'upsert_key',
      'delete_key',
      'list_translations',
      'update_translation',
      'set_status',
      'import_file',
      'export_file',
      'translate_batch',
      'review_batch',
      'run_qa',
      'search_tm',
      'upsert_glossary',
      'list_glossary',
      'sync_git',
      'open_pr',
      'attach_context',
      'list_jobs',
      'get_job',
      'retry_job',
      'auth_register_dev',
      'list_members',
      'invite_member',
      'create_api_key',
      'list_api_keys',
      'billing_status',
      'analytics_snapshot',
      'ota_bundle',
      'community_submit',
      'community_list',
    ],
    bindings: {
      llm: {
        provider: 'zerro',
        model: 'default',
        temperature: 0.2,
      },
      agents: {
        translator: 'l10n-translator',
        reviewer: 'l10n-reviewer',
        qa: 'l10n-qa',
      },
    },
  };
}

export type PluginManifest = L10nPluginManifest;

export type { WorkspaceActionRequest, L10nPluginManifest } from './types';
