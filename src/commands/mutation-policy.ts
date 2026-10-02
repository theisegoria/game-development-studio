/** Per-invocation confirmation for roadmap mutations, independent of paid authority. */
export const ROADMAP_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  'rate_provider_result', 'record_provider_outcome', 'recover_durable_job',
  'quarantine_corrupt_job', 'recover_storage_lock',
  'create_asset_review', 'decide_asset_review', 'package_reviewed_asset',
  'name_visual_baseline', 'compare_visual_matrix', 'decide_visual_regression', 'visual_regression_dashboard',
  'execute_workspace_retention', 'restore_workspace_retention', 'export_workspace_files', 'purge_workspace_retention',
  'save_production_recipe', 'run_production_step', 'recover_production_lock', 'reconcile_production_step',
  'create_asset_family', 'approve_family_sample', 'expand_asset_family',
  'save_platform_preparation', 'prepare_collision_box', 'prepare_texture_variant', 'compress_texture_variant',
]);

export const ROADMAP_FREE_TOOLS: ReadonlySet<string> = new Set([
  ...ROADMAP_MUTATION_TOOLS,
  'get_provider_history', 'diagnose_durable_jobs', 'inspect_workspace_storage',
  'plan_workspace_retention', 'plan_workspace_purge', 'list_workspace_retention', 'plan_release_change',
  'diagnose_texture_compression', 'plan_production_recipe', 'plan_family_approval', 'plan_platform_preparation', 'validate_platform_asset',
]);
