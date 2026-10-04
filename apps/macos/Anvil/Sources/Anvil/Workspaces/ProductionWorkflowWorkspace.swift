import AnvilKit
import SwiftUI

/// A guided surface over the same runtime recipe, never a second execution engine.
struct ProductionWorkflowWorkspace: View {
    @Environment(AnvilModel.self) private var model
    @AppStorage("anvil.lastProductionRecipeID") private var recoveryID = ""
    @State private var draft = ProductionWorkflowDraft()
    @State private var plan: ProductionPlan?
    @State private var preview: JSONValue?
    @State private var previewRequest: JSONValue?
    @State private var previewAnimationSources: [ProductionAnimationSourceInfo]?
    @State private var reviewedStep: ProductionStep?
    @State private var reviewedRequest: RoadmapToolRequest?
    @State private var confirmed = false
    @State private var approveSpend = false
    @State private var ceilingCents = 100
    @State private var readBusy = false
    @State private var startingRun = false
    @State private var activeRunID: RunID?
    @State private var runRecipeID: String?
    @State private var readTask: Task<Void, Never>?
    @State private var readIdentity = UUID()
    @State private var animationSources: [ProductionAnimationSourceInfo] = []
    @State private var message: String?
    @State private var selectedCandidateID = ""
    @State private var reviewer = ""
    @State private var selectionReason = ""

    private var activeRun: Run? { activeRunID.flatMap { model.runs[$0] } }
    private var busy: Bool { readBusy || startingRun || activeRun?.state.isActive == true }
    private var workflowAvailable: Bool {
        model.hasRuntime && ["plan_production_template", "save_production_template", "plan_production_recipe", "run_production_step", "set_production_review"]
            .allSatisfy { RoadmapToolSchemas.all[$0] != nil }
    }
    private var animationInspectionAvailable: Bool {
        model.hasRuntime && workflowAvailable && RoadmapToolSchemas.all["inspect_review_animation"] != nil
    }
    private var animationSampleRequestReady: Bool {
        guard draft.template == .review, draft.sampleAnimation else { return true }
        guard let paths = try? draft.candidateModelPaths(),
              let timeline = try? ProductionAnimationTimeline(sources: animationSources, matching: paths),
              let clip = timeline.clip(at: draft.clipIndex),
              timeline.contains(timeSeconds: draft.clipTimeSeconds, for: clip.index) else { return false }
        guard let confirmation = timeline.nameMappingConfirmationKey(at: clip.index) else { return true }
        return draft.confirmedAnimationClipMapping == confirmation
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Choose a task, preview its recipe, then review one ready step at a time.")
                    .foregroundStyle(.secondary)
                if !workflowAvailable {
                    Text("The matching workflow schemas or bundled runtime are unavailable. Install a verified Anvil package containing its runtime and request resources.")
                        .font(.callout).foregroundStyle(.orange)
                }
                ProductionWorkflowForm(
                    draft: $draft,
                    animationSources: animationSources,
                    animationInspectionAvailable: animationInspectionAvailable,
                    inspectingAnimation: readBusy,
                    onInspectAnimation: inspectAnimationMetadata
                ).disabled(busy)
                HStack {
                    Button("Preview workflow") { previewWorkflow() }
                        .disabled(busy || !workflowAvailable || !animationSampleRequestReady || draft.template == .review && draft.sampleAnimation && !animationInspectionAvailable)
                        .help("Inspect candidate clips, choose a shared clip and sample time, and confirm any differing clip names before previewing.")
                    if previewRequest != nil {
                        Button("Save this recipe") { saveRecipe() }.disabled(busy || !workflowAvailable)
                    }
                    Spacer()
                    SettingsLink { Label("Optional tools", systemImage: "gearshape") }
                }
                if let preview {
                    ProductionTemplatePreview(value: preview)
                }
                Divider()
                HStack {
                    TextField("Saved recipe ID", text: $recoveryID).disabled(busy)
                    Button("Load / refresh") { refreshPlan(recoveryID) }
                        .disabled(busy || !workflowAvailable || !ProductionWorkflowDraft.identifier(recoveryID))
                }
                Text("Saved recipe identity survives a restart. Loading only inspects checkpoints. Uncertain steps require recovery evidence; approval is always renewed.")
                    .font(.caption).foregroundStyle(.secondary)
                if let plan {
                    ProductionRecipeGraph(plan: plan, busy: busy, onReview: reviewStep)
                    if let instruction = plan.raw["nextStep"]?["instruction"]?.stringValue {
                        Text(instruction).font(.callout).foregroundStyle(.secondary)
                    }
                    if case let .array(history)? = plan.raw["historicalCheckpoints"], !history.isEmpty {
                        DisclosureGroup("Previous records outside this graph") {
                            Text("These historical records are not current verified checkpoints. Inspect interrupted operations before recovery.")
                                .font(.caption).foregroundStyle(.secondary)
                            JSONEvidence(value: .array(history))
                        }
                    }
                    if plan.raw["nextStep"]?["kind"]?.stringValue == "select-candidate" {
                        candidateSelection(plan)
                    }
                    if plan.steps.contains(where: { $0.state == .uncertain }) || plan.raw["nextStep"]?["kind"]?.stringValue == "reconcile" {
                        Text("An interrupted step may have been submitted. Inspect its durable job in Runs. Use the advanced recovery tools only after establishing whether it was submitted.")
                            .font(.callout).foregroundStyle(.orange)
                    }
                }
                if let reviewedStep { approval(for: reviewedStep) }
                if let activeRun {
                    HStack {
                        Text("Run \(activeRun.id.description)").font(.caption).textSelection(.enabled)
                        Spacer()
                        if activeRun.state.isActive {
                            ProgressView().controlSize(.small)
                            Button("Cancel run") {
                                clearApproval(); model.runs.cancel(activeRun.id)
                                message = "Cancellation requested. Refresh the recipe before any further step."
                            }
                        }
                    }
                    if let envelope = activeRun.envelope {
                        DisclosureGroup("Actual runtime result") { JSONEvidence(value: envelope.data) }
                    }
                }
                if readBusy {
                    HStack {
                        ProgressView().controlSize(.small)
                        Button("Cancel inspection") { cancelInspection() }
                    }
                }
                if let message { Text(message).font(.callout).textSelection(.enabled) }
            }
            .padding(8)
        }
        .onChange(of: draft) { oldDraft, newDraft in
            preview = nil; previewRequest = nil; previewAnimationSources = nil; clearApproval()
            if oldDraft.template == .review || newDraft.template == .review {
                plan = nil; selectedCandidateID = ""; selectionReason = ""
            }
        }
        .onChange(of: draft.candidatePaths) { _, _ in animationSources = [] }
        .onChange(of: model.outputDirectory) { _, _ in
            cancelInspection(); plan = nil; preview = nil; previewRequest = nil; previewAnimationSources = nil
        }
        .onChange(of: recoveryID) { _, id in
            clearApproval()
            if plan?.recipeID != id { plan = nil }
        }
        .onChange(of: plan?.raw["nextStep"]) { _, _ in selectedCandidateID = ""; selectionReason = "" }
        .onChange(of: activeRun?.state) { _, state in
            guard state?.isTerminal == true, let recipeID = runRecipeID else { return }
            runRecipeID = nil
            refreshPlan(recipeID)
        }
        .onDisappear { cancelInspection() }
    }

    private func candidateSelection(_ plan: ProductionPlan) -> some View {
        let next = plan.raw["nextStep"] ?? .null
        let candidates: [JSONValue] = if case let .array(values)? = next["candidates"] { values } else { [] }
        return GroupBox("Review and select an actual candidate") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Inspect the recorded review before choosing a candidate. This selection records your review; the decision step still needs its own approval.")
                    .foregroundStyle(.secondary)
                if let path = next["dashboardPath"]?.stringValue {
                    Link("Open saved review dashboard", destination: URL(fileURLWithPath: path))
                    Text(path).font(.caption).textSelection(.enabled)
                }
                Picker("Candidate", selection: $selectedCandidateID) {
                    Text("Choose a reviewed candidate").tag("")
                    ForEach(candidates.compactMap { $0["id"]?.stringValue }, id: \.self) { id in
                        let candidate = candidates.first { $0["id"]?.stringValue == id }
                        Text(candidate?["name"]?.stringValue ?? id).tag(id)
                    }
                }
                if let candidate = candidates.first(where: { $0["id"]?.stringValue == selectedCandidateID }) {
                    JSONEvidence(value: candidate)
                }
                TextField("Reviewer", text: $reviewer)
                TextField("Reason for selecting this candidate", text: $selectionReason, axis: .vertical)
                    .lineLimit(2...4)
                Button("Record this selection") { recordSelection(plan) }
                    .disabled(busy || !candidates.contains(where: { $0["id"]?.stringValue == selectedCandidateID })
                              || reviewer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                              || selectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func recordSelection(_ plan: ProductionPlan) {
        guard !busy, let next = plan.raw["nextStep"], next["kind"]?.stringValue == "select-candidate",
              let stepID = next["stepId"]?.stringValue, let fingerprint = next["reviewedFingerprint"]?.stringValue,
              case let .array(candidates)? = next["candidates"],
              candidates.contains(where: { $0["id"]?.stringValue == selectedCandidateID }),
              !reviewer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !selectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        beginMutation("set_production_review", request: .object([
            "recipeId": .string(plan.recipeID), "stepId": .string(stepID), "reviewedFingerprint": .string(fingerprint),
            "candidateId": .string(selectedCandidateID), "reviewer": .string(reviewer), "reason": .string(selectionReason)
        ]), recipeID: plan.recipeID, basis: "Human candidate selection bound to current review fingerprint \(fingerprint).")
        selectedCandidateID = ""; selectionReason = ""
    }

    private func approval(for step: ProductionStep) -> some View {
        GroupBox("Review \(step.id)") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Operation: \(step.operation)").font(.headline)
                if let arguments = step.arguments { JSONEvidence(value: arguments) }
                Text("Current fingerprint: \(step.fingerprint ?? "unavailable")")
                    .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Toggle("Confirm this step and its workspace changes", isOn: $confirmed)
                if step.paid == true {
                    Text("This step can spend money. The invoice cost is unknown here; the runtime enforces the ceiling.")
                        .foregroundStyle(.secondary)
                    Toggle("Approve spend for this invocation", isOn: $approveSpend)
                    TextField("Ceiling in cents", value: $ceilingCents, format: .number)
                }
                Button("Run reviewed step once") { executeStep() }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || !workflowAvailable || !confirmed || reviewedRequest == nil || step.paid == true && (!approveSpend || ceilingCents <= 0))
                    .keyboardShortcut(.return, modifiers: [.command])
                    .accessibilityHint("Executes one step. Clears approval immediately. Does not start the next step.")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func clearApproval() { reviewedStep = nil; reviewedRequest = nil; confirmed = false; approveSpend = false }
    private func cancelInspection() {
        readTask?.cancel(); readTask = nil; readIdentity = UUID(); readBusy = false; clearApproval()
    }
    private func read(_ body: @escaping @MainActor (UUID) async throws -> Void) {
        guard !busy, workflowAvailable else { return }
        clearApproval(); message = nil; readBusy = true
        let identity = UUID(); readIdentity = identity
        readTask = Task {
            defer { if readIdentity == identity { readBusy = false; readTask = nil } }
            do { try await body(identity) }
            catch { if !Task.isCancelled && readIdentity == identity { message = error.localizedDescription } }
        }
    }

    private func inspectAnimationMetadata() {
        guard animationInspectionAvailable else { return }
        do {
            let paths = try draft.candidateModelPaths()
            read { identity in
                let sources = try await inspectAnimationSources(paths, identity: identity)
                guard !Task.isCancelled, readIdentity == identity,
                      (try? draft.candidateModelPaths()) == paths else { return }
                _ = try ProductionAnimationTimeline(sources: sources, matching: paths)
                animationSources = sources
                preview = nil; previewRequest = nil; previewAnimationSources = nil
                plan = nil; selectedCandidateID = ""; clearApproval()
                message = "Read clip metadata for \(sources.count) candidate(s). No preview was rendered."
            }
        } catch { message = error.localizedDescription }
    }

    private func inspectAnimationSources(_ paths: [String], identity: UUID) async throws -> [ProductionAnimationSourceInfo] {
        var sources: [ProductionAnimationSourceInfo] = []
        sources.reserveCapacity(paths.count)
        for path in paths {
            guard !Task.isCancelled, readIdentity == identity else { throw CancellationError() }
            let result = try await model.inspectProductionTool("inspect_review_animation", request: .object(["modelPath": .string(path)]))
            guard !Task.isCancelled, readIdentity == identity else { throw CancellationError() }
            sources.append(try draft.applyAnimationInfo(result, requestedPath: path))
        }
        return sources
    }

    private func previewWorkflow() {
        let needsAnimationInspection = draft.template == .review && draft.sampleAnimation
        guard !needsAnimationInspection || animationInspectionAvailable else { return }
        preview = nil; previewRequest = nil; previewAnimationSources = nil
        plan = nil; selectedCandidateID = ""; selectionReason = ""; clearApproval()
        read { identity in
            let paths = draft.template == .review && draft.sampleAnimation ? try draft.candidateModelPaths() : []
            let freshSources = paths.isEmpty ? [] : try await inspectAnimationSources(paths, identity: identity)
            guard !Task.isCancelled, readIdentity == identity else { return }
            if !freshSources.isEmpty { animationSources = freshSources }
            let request = try draft.request(animationSources: freshSources)
            let result = try await model.inspectProductionTool("plan_production_template", request: request)
            guard !Task.isCancelled, readIdentity == identity,
                  (try? draft.request(animationSources: freshSources)) == request else { return }
            preview = result; previewRequest = request
            previewAnimationSources = paths.isEmpty ? nil : freshSources
        }
    }
    private func refreshPlan(_ recipeID: String) {
        guard ProductionWorkflowDraft.identifier(recipeID) else { return }
        read { identity in
            let result = try await model.inspectProductionTool("plan_production_recipe", request: .object(["recipeId": .string(recipeID)]))
            guard !Task.isCancelled, readIdentity == identity else { return }
            let current = try ProductionPlan(result)
            guard current.recipeID == recipeID else { throw GameDevCLIClientError.invalidInvocation("Recipe identity changed.") }
            recoveryID = recipeID; plan = current
        }
    }
    private func reviewStep(_ selected: ProductionStep) {
        guard let plan else { return }
        let recipeID = plan.recipeID
        read { identity in
            let result = try await model.inspectProductionTool("plan_production_recipe", request: .object(["recipeId": .string(recipeID)]))
            guard !Task.isCancelled, readIdentity == identity else { return }
            let current = try ProductionPlan(result)
            self.plan = current
            guard current.recipeID == recipeID, let step = current.steps.first(where: { $0.id == selected.id }),
                  step.fingerprint == selected.fingerprint else {
                throw GameDevCLIClientError.invalidInvocation("The step changed. Review the refreshed plan.")
            }
            let request = try step.executionRequest(recipeID: recipeID)
            _ = try request.selectedStep(in: result)
            reviewedStep = step; reviewedRequest = request
        }
    }
    private func saveRecipe() {
        guard !busy, workflowAvailable, let request = previewRequest,
              (try? draft.request(animationSources: animationSources)) == request else { return }
        let recipeID = draft.recipeID
        if draft.template == .review && draft.sampleAnimation {
            guard animationInspectionAvailable else { return }
            do {
                let paths = try draft.candidateModelPaths()
                read { identity in
                    let freshSources = try await inspectAnimationSources(paths, identity: identity)
                    guard !Task.isCancelled, readIdentity == identity else { return }
                    guard let reviewedSources = previewAnimationSources, freshSources == reviewedSources else {
                        animationSources = freshSources
                        preview = nil; previewRequest = nil; previewAnimationSources = nil
                        plan = nil; selectedCandidateID = ""; clearApproval()
                        message = "Candidate animation data changed. Review the refreshed timeline and preview again."
                        return
                    }
                    guard (try? draft.request(animationSources: freshSources)) == request else { return }
                    animationSources = freshSources
                    beginMutation("save_production_template", request: request, recipeID: recipeID,
                                  basis: "Save the displayed recipe without executing steps.", whileInspecting: true)
                    previewRequest = nil; previewAnimationSources = nil
                }
            } catch { message = error.localizedDescription }
        } else {
            beginMutation("save_production_template", request: request, recipeID: recipeID,
                          basis: "Save the displayed recipe without executing steps.")
            previewRequest = nil; previewAnimationSources = nil
        }
    }
    private func executeStep() {
        guard !busy, workflowAvailable, confirmed, let step = reviewedStep, let request = reviewedRequest, let plan,
              step.paid != true || approveSpend && ceilingCents > 0 else { return }
        var authorities: Set<Authority> = [.confirm]
        if step.paid == true { authorities.insert(.approveSpend) }
        let grant = ApprovalAuthorization.grantFromHumanApproval(
            ceilingCents: step.paid == true ? ceilingCents : 0, presentedEstimateCents: step.paid == true ? nil : 0,
            presentedConfidence: .estimated, presentedBasis: "Reviewed \(step.operation), fingerprint \(step.fingerprint ?? "").",
            authorities: authorities)
        clearApproval(); startingRun = true
        Task {
            defer { startingRun = false }
            do {
                guard let spec = CommandCatalog.byRegistryTool["run_production_step"] else { return }
                activeRunID = try await model.runRoadmapTool(spec, request: request, grant: grant, paidOperation: step.paid == true ? step.operation : nil)
                recoveryID = plan.recipeID; runRecipeID = plan.recipeID
                message = "One reviewed step started. Follow its recorded result; review the next step separately."
            } catch { message = error.localizedDescription }
        }
    }
    private func beginMutation(_ operation: String, request: JSONValue, recipeID: String, basis: String, whileInspecting: Bool = false) {
        let idle = whileInspecting ? !startingRun && activeRun?.state.isActive != true : !busy
        guard idle, workflowAvailable, RoadmapToolSchemas.all[operation] != nil,
              let spec = CommandCatalog.byRegistryTool[operation] else { return }
        do {
            let body = try RoadmapToolRequest(value: request)
            let grant = ApprovalAuthorization.grantFromHumanApproval(
                ceilingCents: 0, presentedEstimateCents: 0, presentedConfidence: .estimated,
                presentedBasis: basis, authorities: [.confirm])
            clearApproval(); startingRun = true
            Task {
                defer { startingRun = false }
                do {
                    activeRunID = try await model.runRoadmapTool(spec, request: body, grant: grant, paidOperation: nil)
                    recoveryID = recipeID; runRecipeID = recipeID
                    message = "Saved recipe request started. The graph will refresh from the runtime result."
                } catch { message = error.localizedDescription }
            }
        } catch { message = error.localizedDescription }
    }
}

struct JSONEvidence: View {
    let value: JSONValue
    var body: some View {
        Text(value.formattedJSON).font(.system(.caption, design: .monospaced))
            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }
}
