import AnvilKit
import SwiftUI

/// What is being authorized.
///
/// The two cases are deliberately separate. Spending money and running a project's own
/// executable are different decisions with different evidence, and a sheet that blurred
/// them would train someone to click through both.
enum ApprovalSubject {
    /// A paid provider call. Carries the estimate exactly as the toolchain stated it.
    case spend(command: CommandSpec)
    /// A scenario run, resolved into the process it will actually start.
    case execution(plan: ScenarioPlan)
}

/// The one place an ``ApprovalGrant`` is created.
///
/// Everything a person is agreeing to has to be visible here before they can agree:
/// for a run, the executable, its arguments and its declared environment; for a charge,
/// the estimate, how well it is known, and the ceiling that will refuse it.
struct ApprovalSheet: View {
    let subject: ApprovalSubject
    let onApprove: (ApprovalGrant) -> Void
    let onCancel: () -> Void

    @State private var ceilingCents: Int = 500
    @Environment(\.anvilFlattensSurfaces) private var isFlattened

    private var authorities: Set<Authority> {
        switch subject {
        case .spend: [.approveSpend]
        case let .execution(plan): Set(plan.requiredAuthorizations)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Anvil.Space.roomy) {
            header
            Divider()
            VStack(alignment: .leading, spacing: Anvil.Space.regular) {
                switch subject {
                case let .spend(command): spendBody(command)
                case let .execution(plan): executionBody(plan)
                }
                authorityPanel
            }
            .padding(.vertical, Anvil.Space.tight)
            .anvilScrollable(maxHeight: 460)
            Divider()
            footer
        }
        .padding(Anvil.Space.roomy)
        .frame(width: 620)
        .background(.background)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Anvil.Space.regular) {
            Image(systemName: isSpend ? "creditcard.fill" : "play.rectangle.fill")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Anvil.Status.caution)
                .frame(width: 40, height: 40)
                .anvilPanel(tint: Anvil.Status.caution, radius: Anvil.Radius.control)
            VStack(alignment: .leading, spacing: 3) {
                Text(isSpend ? "Authorize a charge" : "Authorize this run")
                    .font(.title3.weight(.semibold))
                Text(
                    isSpend
                        ? "This call spends real money. The estimate below is a guard, not an invoice."
                        : "This starts a process Anvil did not write, from the project you selected."
                )
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    private var isSpend: Bool {
        if case .spend = subject { return true }
        return false
    }

    // MARK: - Spend

    @ViewBuilder
    private func spendBody(_ command: CommandSpec) -> some View {
        Panel(command.title, symbolName: "wand.and.stars") {
            Text(command.summary).font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if case let .paid(cents, confidence, basis) = command.spend {
                ValueRow(label: "Estimated cost", value: money(cents), isMonospaced: true)
                ValueRow(
                    label: "Confidence",
                    value: confidence == .documented ? "Published rate" : "Estimated, not published",
                    tint: confidence == .documented ? nil : Anvil.Status.caution
                )
                // Verbatim. Paraphrasing the toolchain's own statement of where a figure
                // came from would be inventing a new claim about it.
                Text(basis)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        Panel("Ceiling", symbolName: "gauge.with.dots.needle.33percent") {
            Text("The call is refused before it is sent if it would exceed this. It bounds the charge; it does not predict it.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Anvil.Space.regular) {
                Text(money(ceilingCents))
                    .font(.system(.title3, design: .monospaced, weight: .semibold))
                    .contentTransition(.numericText())
                Stepper("", value: $ceilingCents, in: 25...100_000, step: 25)
                    .labelsHidden()
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: - Execution

    @ViewBuilder
    private func executionBody(_ plan: ScenarioPlan) -> some View {
        Panel(plan.title, symbolName: "film.stack") {
            ValueRow(label: "Scenario", value: plan.scenarioID, isMonospaced: true)
            ValueRow(label: "Adapter", value: plan.adapterID, isMonospaced: true)
            ValueRow(label: "Run id", value: plan.runID, isMonospaced: true)
            ValueRow(label: "Timeout", value: "\(plan.timeoutSeconds)s")
        }

        Panel("What will run", symbolName: "terminal") {
            Text(plan.executable)
                .font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if !plan.arguments.isEmpty {
                Text(plan.arguments.joined(separator: " "))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !plan.workingDirectory.isEmpty {
                ValueRow(label: "Working directory", value: plan.workingDirectory, isMonospaced: true)
            }
        }

        if !plan.environment.isEmpty {
            // Part of what is being approved: these select which driver runs, so they
            // change what the run means.
            Panel("Declared environment", symbolName: "leaf") {
                Text("The scenario sets these for its own process. They come from a fixed allowlist; loader variables and the display are refused.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(plan.environment.keys.sorted(), id: \.self) { key in
                    ValueRow(
                        label: key,
                        value: plan.environment[key] ?? "",
                        isMonospaced: true,
                        labelWidth: 230
                    )
                }
            }
        }

        if !plan.graphicsLanes.isEmpty {
            Panel("Graphics lanes", symbolName: "cpu") {
                HStack(spacing: Anvil.Space.tight) {
                    ForEach(plan.graphicsLanes, id: \.self) { lane in
                        StatusChip(label: lane.label, symbolName: "square.stack.3d.up", tint: Anvil.Status.inert)
                    }
                    Spacer(minLength: 0)
                }
                if plan.isSoftwareLane {
                    // Said plainly here so nobody reads the resulting run as GPU evidence.
                    Label(
                        "This is a software rasterizer. It runs on the CPU, needs no GPU authority, and the run it produces will carry no GPU or hardware-timing evidence.",
                        systemImage: "info.circle"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Authorities

    private var authorityPanel: some View {
        Panel("You are granting", symbolName: "checkmark.shield") {
            // Exactly what the plan named — never derived from capabilities, so a run
            // that needs only confirmation never shows a GPU prompt.
            ForEach(Authority.allCases.filter(authorities.contains), id: \.self) { authority in
                HStack(alignment: .top, spacing: Anvil.Space.snug) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Anvil.Status.caution)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(authority.grantTitle).font(.callout.weight(.medium))
                        Text(authority.grantExplanation)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Text("This grant covers this one invocation. It is not remembered.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.top, Anvil.Space.tight)
        }
    }

    private var footer: some View {
        HStack(spacing: Anvil.Space.snug) {
            Spacer(minLength: 0)
            Button("Cancel", role: .cancel, action: onCancel)
                .keyboardShortcut(.cancelAction)
            Button(isSpend ? "Approve \(money(ceilingCents)) ceiling" : "Run") {
                onApprove(grant())
            }
            .keyboardShortcut(.defaultAction)
            .anvilGlassProminentButton(isFlattened: isFlattened)
        }
    }

    /// The only call to the grant factory in the app. Reached solely from this button.
    private func grant() -> ApprovalGrant {
        var estimate = 0
        var confidence = CostConfidence.documented
        var basis = "No charge: this run starts a local process and sends nothing to a provider."
        if case let .spend(command) = subject, case let .paid(cents, stated, statedBasis) = command.spend {
            estimate = cents
            confidence = stated
            basis = statedBasis
        }
        return ApprovalAuthorization.grantFromHumanApproval(
            ceilingCents: isSpend ? ceilingCents : 0,
            presentedEstimateCents: estimate,
            presentedConfidence: confidence,
            presentedBasis: basis,
            authorities: authorities
        )
    }

    private func money(_ cents: Int) -> String {
        "$\(cents / 100).\(String(format: "%02d", cents % 100))"
    }
}

extension Authority {
    var grantTitle: String {
        switch self {
        case .confirm: "Run this once"
        case .approveSpend: "Spend up to the ceiling"
        case .allowGPU: "Use the GPU"
        case .allowPerformance: "Record timings"
        }
    }

    var grantExplanation: String {
        switch self {
        case .confirm:
            "Starts the declared process for this invocation only."
        case .approveSpend:
            "Contacts a paid provider. The call is refused before it is sent if it would exceed the ceiling."
        case .allowGPU:
            "Lets the run use hardware acceleration. The harness still does not prove that it did."
        case .allowPerformance:
            "Admits this run's timings as evidence. Timings from a software lane are refused regardless."
        }
    }
}
