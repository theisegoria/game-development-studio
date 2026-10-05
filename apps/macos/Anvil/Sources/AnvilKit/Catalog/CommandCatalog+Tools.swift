import Foundation

extension CommandCatalog {
    /// The registry tools, reached through `game-dev tool call <name>`.
    ///
    /// Only the metadata that is *not* machine-readable lives here: title, summary,
    /// spend class, exclusion lane and UI route. Argument schemas are deliberately
    /// absent — MCP `tools/list` publishes the real JSON Schema for every one of these,
    /// so Anvil harvests it at runtime instead of transcribing ~200 fields that would
    /// drift the first time an upstream default changed.
    ///
    /// Cost figures mirror `src/domain/spend.ts`. `documented` means the provider
    /// publishes the rate; `estimated` means it does not, and the ceiling is a refusal
    /// guard rather than an invoice.
    static let toolCommands: [CommandSpec] = [
        // MARK: - Spend and provider outcomes
        tool(
            "get_provider_history",
            title: "Provider cost and quality history",
            summary: "Compare estimates, reported charges, failures and reviewed quality; unknown invoice costs remain unknown.",
            route: .spend
        ),
        tool(
            "record_provider_outcome",
            title: "Record a provider outcome",
            summary: "Record reported charges and execution outcomes without inventing provider invoice costs.",
            lane: .workspaceWrite,
            route: .spend,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "rate_provider_result",
            title: "Review provider quality",
            summary: "Record a human quality assessment against the provider result.",
            lane: .workspaceWrite,
            route: .spend,
            durable: true,
            authorities: [.confirm]
        ),
        // MARK: - Storage and job recovery
        tool("list_optional_tools", title: "Inspect optional tool selections",
             summary: "Verify saved executable file identities without launching tools.", route: .setup),
        tool("configure_optional_tool", title: "Save an optional tool selection",
             summary: "Validate bounded executable file identity and save an explicit per-user selection.",
             lane: .workspaceWrite, route: .setup, durable: true, authorities: [.confirm]),
        tool("clear_optional_tool", title: "Clear a saved optional tool selection",
             summary: "Remove one saved selection, preserving the executable and assets.",
             lane: .workspaceWrite, route: .setup, durable: true, authorities: [.confirm]),
        tool("preview_support_report", title: "Preview a redacted support report",
             summary: "Inspect allowlisted workflow diagnostics locally before sharing.", route: .setup),
        tool("write_support_report", title: "Write a new redacted support report",
             summary: "Write a new local report after review, refusing overwrites and sending nothing.",
             lane: .workspaceWrite, route: .setup, durable: true, authorities: [.confirm]),
        tool(
            "diagnose_durable_jobs",
            title: "Diagnose durable jobs",
            summary: "Inspect corrupt, stale and interrupted records without resubmitting work.",
            route: .runs
        ),
        tool(
            "recover_durable_job",
            title: "Recover a durable job",
            summary: "Recover an interrupted local record with explicit evidence; never automatically repeat paid submissions.",
            lane: .workspaceWrite,
            route: .runs,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "quarantine_corrupt_job",
            title: "Quarantine a corrupt job",
            summary: "Preserve an unreadable job for inspection and explicitly remove it from the active index.",
            lane: .workspaceWrite,
            route: .runs,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "recover_storage_lock",
            title: "Recover a storage lock",
            summary: "Release a stale storage lock only after proving its recorded owner stopped.",
            lane: .workspaceWrite,
            route: .runs,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "inspect_workspace_storage",
            title: "Measure workspace storage",
            summary: "Measure original, derived and capture files with protected references.",
            route: .setup
        ),
        tool(
            "plan_workspace_retention",
            title: "Plan workspace retention",
            summary: "Preview measured cleanup candidates and protected files before changing anything.",
            route: .setup
        ),
        tool(
            "execute_workspace_retention",
            title: "Apply a retention plan",
            summary: "Confirm the current plan and move eligible files into reversible quarantine.",
            lane: .workspaceWrite,
            route: .setup,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "restore_workspace_retention",
            title: "Restore retained files",
            summary: "Restore files from a previous retention transaction.",
            lane: .workspaceWrite,
            route: .setup,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "list_workspace_retention",
            title: "List retention transactions",
            summary: "Inspect previous retention plans and reversible transactions.",
            route: .setup
        ),
        tool(
            "plan_workspace_purge",
            title: "Plan permanent quarantine deletion",
            summary: "Preview irreversible deletion of completed quarantine files; recheck protected references and digests. Deletes nothing.",
            route: .setup
        ),
        tool(
            "purge_workspace_retention",
            title: "Permanently delete quarantined files",
            summary: "IRREVERSIBLE: permanently delete the exact reviewed quarantine files. Deleted bytes cannot be restored; export anything needed first. ALL other workspace and quarantine writers must be stopped. Portable path checks are not a security boundary against hostile concurrent writers.",
            lane: .workspaceWrite,
            route: .setup,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "export_workspace_files",
            title: "Export workspace files",
            summary: "Copy verified workspace files to an explicitly chosen folder without replacing originals.",
            lane: .workspaceWrite,
            route: .library,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "plan_release_change",
            title: "Plan an upgrade or rollback",
            summary: "Inspect verified GitHub release artifacts and dependencies before choosing an upgrade or rollback.",
            route: .setup
        ),
        // MARK: - Asset inspection and review
        tool("inspect_review_animation", title: "Inspect animation review clips",
             summary: "Read bounded clip durations and source identity without rendering or writing.", route: .library),
        tool(
            "create_asset_review",
            title: "Create an asset review",
            summary: "Prepare visual and measured evidence for candidate inspection; rendering shows its local process intent.",
            lane: .workspaceWrite,
            route: .library,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "decide_asset_review",
            title: "Approve or reject a candidate",
            summary: "Record a human decision bound to the current asset and review evidence.",
            lane: .workspaceWrite,
            route: .library,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "package_reviewed_asset",
            title: "Package an approved asset",
            summary: "Build a standalone package only from a current approved asset review.",
            lane: .workspaceWrite,
            route: .library,
            durable: true,
            authorities: [.confirm]
        ),
        // MARK: - Visual regression review
        tool(
            "name_visual_baseline",
            title: "Name a visual baseline",
            summary: "Bind a named baseline to verified capture evidence.",
            lane: .workspaceWrite,
            route: .visual,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "compare_visual_matrix",
            title: "Compare a scenario matrix",
            summary: "Create sealed comparisons across named scenarios and baselines.",
            lane: .workspaceWrite,
            route: .visual,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "decide_visual_regression",
            title: "Review an expected visual change",
            summary: "Record an expected-change decision; pixel differences alone do not establish quality.",
            lane: .workspaceWrite,
            route: .visual,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "visual_regression_dashboard",
            title: "Build the regression dashboard",
            summary: "Write a dashboard of baseline history, scenario comparisons and human decisions.",
            lane: .workspaceWrite,
            route: .visual,
            durable: true,
            authorities: [.confirm]
        ),
        // MARK: - Production recipes and families
        tool(
            "list_production_templates", title: "List guided workflow templates",
            summary: "Inspect the shipped free workflow templates without executing steps.", route: .createBrief
        ),
        tool(
            "plan_production_template", title: "Preview a guided workflow",
            summary: "Expand task form values into the canonical recipe and inspect required capabilities.", route: .createBrief
        ),
        tool(
            "save_production_template", title: "Save a guided workflow",
            summary: "Persist the reviewed template recipe without executing its steps.",
            lane: .workspaceWrite, route: .createBrief, durable: true, authorities: [.confirm]
        ),
        tool(
            "set_production_review", title: "Record a reviewed candidate selection",
            summary: "Bind an actual candidate and human review to the current review fingerprint. Execution needs a separate approval.",
            lane: .workspaceWrite, route: .createBrief, durable: true, authorities: [.confirm]
        ),
        tool(
            "save_production_recipe",
            title: "Save a production recipe",
            summary: "Persist a versioned graph without executing steps or carrying forward approval.",
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "plan_production_recipe",
            title: "Plan the next production step",
            summary: "Inspect input fingerprints, checkpoints and the exact arguments needing approval.",
            route: .createBrief
        ),
        tool(
            "run_production_step",
            title: "Run one approved production step",
            summary: "Execute one fingerprint-bound step; any paid operation still requires fresh, separate spend approval for this invocation.",
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "recover_production_lock",
            title: "Recover a production lock",
            summary: "Recover a stopped recipe owner while keeping uncertain submissions blocked.",
            lane: .workspaceWrite,
            route: .runs,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "reconcile_production_step",
            title: "Reconcile an uncertain step",
            summary: "Record evidence that no submission occurred before allowing another attempt.",
            lane: .workspaceWrite,
            route: .runs,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "create_asset_family",
            title: "Create an asset family",
            summary: "Save shared style, scale, palette and naming, and create the first sample recipe.",
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "plan_family_approval",
            title: "Review the family sample",
            summary: "Inspect current validated and packaged sample evidence before approving expansion.",
            route: .createBrief
        ),
        tool(
            "approve_family_sample",
            title: "Approve the family sample",
            summary: "Approve the current sample digest; this decision grants no provider spend authority.",
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "expand_asset_family",
            title: "Expand an approved family",
            summary: "Create remaining recipes from the approved sample; does not call providers.",
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true,
            authorities: [.confirm]
        ),
        // MARK: - Standalone platform preparation
        tool(
            "plan_platform_preparation",
            title: "Plan platform variants",
            summary: "Plan LOD, texture, material, collision and budget steps, with unavailable capabilities explicit.",
            route: .mesh
        ),
        tool(
            "save_platform_preparation",
            title: "Save platform preparation",
            summary: "Save supported variant preparation as a resumable, individually approved recipe.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "prepare_texture_variant",
            title: "Prepare a texture variant",
            summary: "Resize embedded GLB textures locally with color-aware filtering and normal renormalization.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "diagnose_texture_compression",
            title: "Diagnose texture compression",
            summary: "Verify the configured Basis CPU encoder identity and report missing setup without starting a process.",
            route: .setup
        ),
        tool(
            "compress_texture_variant",
            title: "Compress a texture variant",
            summary: "Create embedded KTX2 textures with the pinned Basis CPU encoder and verify every mip by CPU transcoding. No provider cost.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "diagnose_collision_decomposition",
            title: "Diagnose collision decomposition",
            summary: "Inspect the configured CoACD CPU worker with a bounded metadata-only Python process; no decomposition, Blender or GPU work.",
            route: .setup
        ),
        tool(
            "decompose_collision_mesh",
            title: "Decompose collision geometry",
            summary: "Create validated standalone convex parts using the pinned CPU-only CoACD worker. No engine verification or provider cost.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "prepare_collision_box",
            title: "Prepare a collision box",
            summary: "Create a conservative standalone AABB proxy from measured geometry; no engine verification.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "validate_platform_asset",
            title: "Validate platform budgets",
            summary: "Measure triangle, material and texture budgets; unknown dimensions fail closed.",
            route: .mesh
        ),
        // MARK: - Existing asset and harness operations
        tool("measure_run_stability", title: "Measure capture stability",
             summary: "Measure the noise floor across repeated captures.", lane: .workspaceWrite, route: .visual),
        tool("analyze_frame_sequence", title: "Find flicker and popping",
             summary: "Read one run's frames in order for flicker, popping and uneven frame pacing.",
             lane: .workspaceWrite, route: .visual),
        tool("list_run_diagnostics", title: "Group validation errors",
             summary: "Group a run's validation and debug messages, and name what is new since a baseline.",
             route: .scenarios),
        tool("start_live_session", title: "Start a live session",
             summary: "Launch the engine for interactive snapshots, state queries, pause and step. Never evidence.",
             lane: .workspaceWrite, route: .scenarios, authorities: [.confirm]),
        tool("live_session_snapshot", title: "Snapshot a live session",
             summary: "Show the running engine's current frame.", lane: .workspaceWrite, route: .scenarios),
        tool("live_session_query", title: "Query a live session",
             summary: "Ask the running engine about its own state; the answer is the engine's claim.", route: .scenarios),
        tool("live_session_control", title: "Pause, step or resume",
             summary: "Hold the frame, render exactly N more, or let it run.", route: .scenarios),
        tool("end_live_session", title: "End a live session",
             summary: "Stop the engine and return the session record.", route: .scenarios),
        tool("promote_live_session", title: "Promote a session",
             summary: "Plan a sealed scenario run that reproduces what a session found.", route: .scenarios),
        tool("performance_breakdown", title: "Break down frame time",
             summary: "Show each pass's own time from spans or a trace, and which passes grew since a baseline.",
             route: .performance),
        tool(
            "preview_asset_prompt",
            title: "Preview a prompt",
            summary: "Show the prompt, negative prompt and directives a spec would produce. Free and local.",
            route: .createPrompt
        ),
        tool(
            "create_game_prop",
            title: "Start a prop from a brief",
            summary: "Turn a brief into reference candidates. Stops before 3D spend so art direction stays human.",
            spend: .paid(cents: 10, confidence: .estimated, basis: "Leonardo, per image."),
            lane: .workspaceWrite,
            route: .createBrief,
            durable: true
        ),
        tool(
            "generate_asset_reference",
            title: "Generate references",
            summary: "Generate reference images for an asset spec.",
            spend: .paid(cents: 10, confidence: .estimated, basis: "Leonardo, per image."),
            lane: .workspaceWrite,
            route: .createReferences,
            durable: true
        ),
        tool(
            "generate_reference_variations",
            title: "Explore variations",
            summary: "Vary an existing reference along one axis, as a child job.",
            spend: .paid(cents: 10, confidence: .estimated, basis: "Leonardo, per image."),
            lane: .workspaceWrite,
            route: .createReferences,
            durable: true
        ),
        tool(
            "select_reference",
            title: "Select a reference",
            summary: "Choose which candidate to reconstruct. Free, and the step that advances the job.",
            route: .createReferences,
            durable: true
        ),
        tool(
            "create_3d_asset",
            title: "Reconstruct in 3D",
            summary: "Reconstruct a mesh from a reference, image or prompt. Asynchronous; provider URLs expire.",
            spend: .paid(cents: 30, confidence: .documented, basis: "Tripo image-to-3D with texture, 30 credits at $0.01."),
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "texture_existing_asset",
            title: "Texture a mesh",
            summary: "Generate PBR textures for a mesh you already have, preserving geometry and UVs.",
            spend: .paid(cents: 20, confidence: .documented, basis: "Tripo HD texture."),
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "rig_asset",
            title: "Rig an asset",
            summary: "Generate a skeleton and skin weights. Must precede animation.",
            spend: .paid(cents: 25, confidence: .documented, basis: "Tripo auto-rig."),
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "animate_asset",
            title: "Animate an asset",
            summary: "Retarget an animation onto a rigged asset. Refuses an unrigged source.",
            spend: .paid(cents: 10, confidence: .documented, basis: "Tripo animation retarget, per animation."),
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "retopologize_asset",
            title: "Retopologize",
            summary: "Rebuild an asset's topology, optionally as quads.",
            spend: .paid(cents: 30, confidence: .documented, basis: "Tripo smart retopology v2."),
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "generate_sound_effect",
            title: "Generate a sound effect",
            summary: "Generate a game sound effect or ambience loop into the workspace.",
            spend: .paid(cents: 10, confidence: .estimated, basis: "Leonardo, per clip."),
            lane: .workspaceWrite,
            route: .createAudio,
            durable: true
        ),
        tool(
            "get_asset_job",
            title: "Get a job",
            summary: "Read one asset job, refreshing its provider state. Never spends.",
            route: .runs
        ),
        tool(
            "list_asset_jobs",
            title: "List asset jobs",
            summary: "List asset jobs newest first, without contacting the provider.",
            route: .runs
        ),
        tool(
            "download_asset",
            title: "Download an asset",
            summary: "Download a finished asset and extract embedded textures. Free, but writes files.",
            lane: .workspaceWrite,
            route: .create3D,
            durable: true
        ),
        tool(
            "inspect_asset",
            title: "Inspect an asset",
            summary: "Measure geometry, materials, textures and bounds. Free and fully local.",
            route: .mesh
        ),
        tool(
            "extract_pbr_trio",
            title: "Extract PBR planes",
            summary: "Split a material into albedo, normal, roughness, metallic and occlusion planes.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true
        ),
        tool(
            "normalize_mesh",
            title: "Normalize a mesh",
            summary: "Repair a mesh with Blender so it can be textured and shipped.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true
        ),
        tool(
            "validate_game_asset",
            title: "Validate an asset",
            summary: "Check an asset against the policy, with every threshold overridable.",
            route: .mesh
        ),
        tool(
            "batch_prepare_meshes",
            title: "Prepare meshes in bulk",
            summary: "Validate, normalize and re-validate up to 500 meshes. Degrades to report-only without Blender.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true
        ),
        tool(
            "get_spend_report",
            title: "Spend report",
            summary: "Running total, headroom and per-tool breakdown, flagging which figures are estimates.",
            route: .spend
        ),

        // The five harness tools that moved onto the shared registry, so they are
        // reachable over both transports rather than through CLI dispatch alone.
        tool(
            "verify_capture_run",
            title: "Verify a run",
            summary: "Re-check a sealed run bundle's closed roster and canonical manifest.",
            route: .scenarios
        ),
        tool(
            "analyze_capture_run",
            title: "Analyze a capture",
            summary: "Decode a run's raster attachments and report per-channel statistics.",
            route: .visual
        ),
        tool(
            "compare_capture_visuals",
            title: "Compare captures",
            summary: "Diff two runs with per-pixel metrics, semantic regions and a heatmap.",
            lane: .workspaceWrite,
            route: .visual,
            durable: true
        ),
        // Scenario planning and execution reached the registry with their own gate:
        // `run_scenario` starts a process the harness did not write, so MCP confirms it
        // per call rather than relying on launch-time authority alone. Anvil mirrors
        // that by requiring the same three authorities the CLI demands.
        tool(
            "plan_scenario_run",
            title: "Plan a scenario",
            summary: "Resolve a scenario into the process, arguments and authorities a run would need. Runs nothing.",
            route: .scenarios
        ),
        tool(
            "run_scenario",
            title: "Run a scenario",
            summary: "Execute a scenario the project owns and seal the result into a run bundle.",
            lane: .workspaceWrite,
            route: .scenarios,
            durable: true,
            authorities: [.confirm, .allowGPU, .allowPerformance]
        ),
        // Project onboarding reached the registry: adapter templates and the probe SDK,
        // each as a plan step and an install step. The installs write into a project the
        // user owns, so they carry confirm, and they serialize on that project.
        tool(
            "list_adapter_templates",
            title: "Adapter templates",
            summary: "List the capture adapter templates that ship with the toolchain.",
            route: .setup
        ),
        tool(
            "plan_adapter_install",
            title: "Plan an adapter install",
            summary: "Show what installing an adapter template into a project would write. Writes nothing.",
            route: .setup
        ),
        tool(
            "install_adapter_template",
            title: "Install an adapter",
            summary: "Write an adapter manifest into a project, refusing to overwrite a different one.",
            lane: .project("project"),
            route: .setup,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "plan_probe_install",
            title: "Plan a probe SDK install",
            summary: "Show what vendoring the probe SDK sources into a project would write. Writes nothing.",
            route: .setup
        ),
        tool(
            "install_probe_sdk",
            title: "Install the probe SDK",
            summary: "Vendor the probe SDK sources into a project so its engine can produce sealed captures.",
            lane: .project("project"),
            route: .setup,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "render_asset_contact_sheet",
            title: "Contact sheet",
            summary: "Draw an asset's UV layout and textures as one image, so the asset can be looked at rather than described.",
            lane: .workspaceWrite,
            route: .mesh,
            durable: true
        ),
        tool(
            "run_doctor",
            title: "Check the environment",
            summary: "Report what this environment can and cannot do, including what it cannot prove.",
            route: .overview
        ),
        // The bounded optimisation loop, as plan/commit pairs. The two committing tools
        // write a goal file into the user's project, so they carry confirm and serialize
        // on that project — the same authority the harness requires of them.
        tool(
            "plan_optimization_goal",
            title: "Plan a goal",
            summary: "Show the bounded optimisation goal that would be created. Writes nothing.",
            route: .performance
        ),
        tool(
            "create_optimization_goal",
            title: "Create a goal",
            summary: "Bind a baseline run to a target metric, direction and iteration budget.",
            lane: .project("project"),
            route: .performance,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "plan_goal_evaluation",
            title: "Plan an evaluation",
            summary: "Score a candidate against a goal without consuming an iteration of its budget.",
            route: .performance
        ),
        tool(
            "evaluate_optimization_goal",
            title: "Record an evaluation",
            summary: "Score a candidate run against a goal and consume one iteration of its budget.",
            lane: .project("project"),
            route: .performance,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "credentials_status",
            title: "Credential status",
            summary: "Report which provider credentials are configured. Values are never returned.",
            route: .overview
        ),
        // Packages and the catalog. `build_asset_package` writes only into the tool's own
        // package store, so it takes a plan step rather than confirmation; vendoring
        // writes into the user's project and carries confirm.
        tool(
            "plan_asset_package",
            title: "Plan a package",
            summary: "Show where a package would be written and what it would contain. Writes nothing, and assigns no id.",
            route: .library
        ),
        tool(
            "build_asset_package",
            title: "Build a package",
            summary: "Package a model with its metadata, provenance and validation, then index it.",
            lane: .packageStore,
            route: .library,
            durable: true
        ),
        tool(
            "verify_asset_package",
            title: "Verify a package",
            summary: "Re-hash a package's files and confirm they still match its manifest.",
            route: .library
        ),
        tool(
            "list_catalog_assets",
            title: "Search the catalog",
            summary: "Search indexed packages by text, category or validation state.",
            route: .library
        ),
        tool(
            "show_catalog_asset",
            title: "Show a catalog entry",
            summary: "Read one indexed package's catalog record.",
            route: .library
        ),
        tool(
            "plan_vendor_admission",
            title: "Plan vendoring",
            summary: "Show what admitting a package into a project would copy, and any blockers. Writes nothing.",
            route: .library
        ),
        tool(
            "vendor_package_into_project",
            title: "Vendor into a project",
            summary: "Copy a verified package into a game project and record it in the vendor lock.",
            lane: .packageStore,
            route: .library,
            durable: true,
            authorities: [.confirm]
        ),
        tool(
            "summarize_run_performance",
            title: "Summarize performance",
            summary: "Aggregate a run's metrics into per-metric distributions.",
            route: .performance
        ),
        tool(
            "compare_run_performance",
            title: "Compare performance",
            summary: "Compare two runs metric by metric, carrying sample counts and deviations.",
            route: .performance
        )
    ]

    private static func tool(
        _ name: String,
        title: String,
        summary: String,
        spend: SpendClass = .free,
        lane: ExclusionLane = .none,
        route: WorkspaceRoute,
        durable: Bool = false,
        authorities: Set<Authority> = []
    ) -> CommandSpec {
        CommandSpec(
            id: "tool.\(name)",
            path: ["tool", "call", name],
            title: title,
            summary: summary,
            arguments: [.flag("request", "Request body", kind: .jsonRequest)],
            transport: .events,
            authorities: spend.isPaid ? authorities.union([.approveSpend]) : authorities,
            spend: spend,
            conditionalSpend: name == "run_production_step",
            lane: lane,
            route: route,
            registryTool: name,
            createsDurableJob: durable
        )
    }
}
