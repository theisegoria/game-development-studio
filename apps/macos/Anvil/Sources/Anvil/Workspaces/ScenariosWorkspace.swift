import AnvilKit
import SwiftUI

/// Adapters, planned runs, and the sealed bundles they produce.
///
/// The order is deliberate and matches the toolchain's: resolve a plan, look at it,
/// then authorize it. There is no button that runs a scenario without showing the plan
/// first, because the plan is the thing being approved.
struct ScenariosWorkspace: View {
    let projectPath: String
    let scenarios: [ScenarioSummary]
    let plan: ScenarioPlan?
    let recentRuns: [Run]
    var error: String?
    var onChooseProject: () -> Void = {}
    var onPlan: (String) -> Void = { _ in }
    var onRun: (ScenarioPlan, ApprovalGrant) -> Void = { _, _ in }

    @State private var selected: String?
    @State private var showingApproval = false
    @Environment(\.anvilFlattensSurfaces) private var isFlattened

    var body: some View {
        Group {
            if isFlattened {
                // Rendered directly in a preview. `@Environment` is only populated
                // inside a live hierarchy, so a scene must render the whole view and let
                // the body branch, rather than reaching in for `content` from outside.
                content
            } else {
                ScrollView {
                    GlassEffectContainer(spacing: Anvil.Space.regular) { content }
                }
                .scrollEdgeEffectStyle(.soft, for: .top)
            }
        }
        .background(.background)
        .navigationTitle(WorkspaceRoute.scenarios.title)
        .sheet(isPresented: $showingApproval) {
            if let plan {
                ApprovalSheet(
                    subject: .execution(plan: plan),
                    onApprove: { grant in
                        showingApproval = false
                        onRun(plan, grant)
                    },
                    onCancel: { showingApproval = false }
                )
            }
        }
    }

    @ViewBuilder
    var content: some View {
        VStack(alignment: .leading, spacing: Anvil.Space.roomy) {
            WorkspaceHeading(
                title: WorkspaceRoute.scenarios.title,
                subtitle: WorkspaceRoute.scenarios.subtitle,
                symbolName: WorkspaceRoute.scenarios.symbolName
            )

            if projectPath.isEmpty {
                Panel {
                    NothingHere(
                        title: "No project selected",
                        message: "Choose a project with a capture adapter, or install one from Setup. Anvil reads its scenarios from the adapter manifest.",
                        symbolName: "folder.badge.questionmark"
                    )
                    HStack {
                        Spacer(minLength: 0)
                        Button("Choose Project…", action: onChooseProject)
                            .anvilGlassProminentButton(isFlattened: isFlattened)
                        Spacer(minLength: 0)
                    }
                }
            } else {
                if let error {
                    Panel("The adapter could not be read", symbolName: "exclamationmark.triangle.fill") {
                        Text(error)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                projectPanel
                if scenarios.isEmpty {
                    Panel {
                        NothingHere(
                            title: "No scenarios declared",
                            message: "This project's adapter manifest declares no scenarios. Install an adapter template from Setup to get one.",
                            symbolName: WorkspaceRoute.scenarios.symbolName
                        )
                    }
                } else {
                    scenarioList
                }
                if let plan { planPanel(plan) }
                if !recentRuns.isEmpty { runsPanel }
            }
        }
        .padding(Anvil.Space.roomy)
        .frame(maxWidth: Anvil.readableWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private var projectPanel: some View {
        Panel("Project", symbolName: "folder", accessory: {
            Button("Change…", action: onChooseProject).controlSize(.small)
        }) {
            ValueRow(label: "Path", value: projectPath, isMonospaced: true)
            ValueRow(label: "Scenarios", value: "\(scenarios.count)")
        }
    }

    private var scenarioList: some View {
        Panel("Scenarios", symbolName: WorkspaceRoute.scenarios.symbolName) {
            ForEach(scenarios) { scenario in
                VStack(alignment: .leading, spacing: Anvil.Space.tight) {
                    HStack(alignment: .firstTextBaseline, spacing: Anvil.Space.snug) {
                        Text(scenario.title).font(.callout.weight(.medium))
                        Text(scenario.id)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Spacer(minLength: Anvil.Space.snug)
                        Button("Plan") {
                            selected = scenario.id
                            onPlan(scenario.id)
                        }
                        .controlSize(.small)
                        .anvilGlassButton(isFlattened: isFlattened)
                    }
                    HStack(spacing: Anvil.Space.tight) {
                        if !scenario.producesCapture {
                            StatusChip(label: "no capture", symbolName: "eye.slash", tint: Anvil.Status.inert)
                        }
                        ForEach(scenario.capabilities, id: \.self) { capability in
                            StatusChip(
                                label: capability.label,
                                symbolName: capability == .softwareRaster ? "cpu" : "square.stack.3d.up",
                                tint: capability == .gpu || capability == .metal
                                    ? Anvil.Status.caution
                                    : Anvil.Status.inert
                            )
                        }
                        Spacer(minLength: 0)
                    }
                }
                .padding(Anvil.Space.snug)
                .frame(maxWidth: .infinity, alignment: .leading)
                .anvilPanel(
                    tint: scenario.id == selected ? Anvil.Status.active : .clear,
                    radius: Anvil.Radius.control
                )
            }
        }
    }

    private func planPanel(_ plan: ScenarioPlan) -> some View {
        Panel("Resolved plan", symbolName: "list.bullet.rectangle.portrait") {
            Text("Nothing has run. This is what a run would do, resolved from the adapter manifest.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ValueRow(label: "Executable", value: plan.executable, isMonospaced: true)
            if !plan.arguments.isEmpty {
                ValueRow(label: "Arguments", value: plan.arguments.joined(separator: " "), isMonospaced: true)
            }
            ValueRow(label: "Run id", value: plan.runID, isMonospaced: true)
            ValueRow(label: "Timeout", value: "\(plan.timeoutSeconds)s")
            if !plan.environment.isEmpty {
                ValueRow(
                    label: "Environment",
                    value: plan.environment.keys.sorted().joined(separator: ", "),
                    isMonospaced: true
                )
            }
            HStack(spacing: Anvil.Space.tight) {
                Text("Requires").font(.caption).foregroundStyle(.secondary)
                ForEach(plan.requiredAuthorizations, id: \.self) { authority in
                    StatusChip(label: authority.grantTitle, symbolName: "checkmark.shield", tint: Anvil.Status.caution)
                }
                Spacer(minLength: 0)
            }
            HStack {
                Spacer(minLength: 0)
                Button("Review and run…") { showingApproval = true }
                    .anvilGlassProminentButton(isFlattened: isFlattened)
            }
            EvidenceCeilingNote(text: plan.evidenceCeiling)
        }
    }

    private var runsPanel: some View {
        Panel("Sealed runs", symbolName: "shippingbox") {
            ForEach(recentRuns) { run in
                HStack(spacing: Anvil.Space.snug) {
                    StatusChip(label: run.state.label, symbolName: run.state.symbolName, tint: run.state.tint)
                    Text(run.title).font(.callout)
                    Spacer(minLength: 0)
                    if let artifact = run.artifacts.first(where: { $0.kind == "run_bundle" }) {
                        Text(artifact.path)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }
}
