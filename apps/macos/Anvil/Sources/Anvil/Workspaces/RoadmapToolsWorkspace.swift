import AnvilKit
import SwiftUI

/// A narrow schema-backed executor for production tools. Bespoke scenario/review pages remain intact.
struct RoadmapToolsWorkspace: View {
    @Environment(AnvilModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID = "tool.plan_production_recipe"
    @State private var requestJSON = "{}"
    @State private var confirmed = false
    @State private var approveSpend = false
    @State private var ceilingCents = 100
    @State private var reviewedStep: JSONValue?
    @State private var busy = false
    @State private var message: String?
    @State private var advanced = false

    private var spec: CommandSpec? { CommandCatalog[selectedID] }
    private var operation: String? { reviewedStep?["operation"]?.stringValue }
    private var paidStep: Bool { reviewedStep?["paid"] == .bool(true) }
    private var canRun: Bool {
        guard let spec, spec.registryTool.map({ RoadmapToolSchemas.all[$0] != nil }) == true else { return false }
        return model.hasRuntime && !busy && (!spec.authorities.contains(.confirm) || confirmed)
            && (!spec.conditionalSpend || reviewedStep != nil) && (!paidStep || (approveSpend && ceilingCents > 0))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Production workflows").font(.title2.bold())
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Picker("Interface", selection: $advanced) {
                Text("Guided tasks").tag(false)
                Text("Advanced JSON").tag(true)
            }.pickerStyle(.segmented)
            if !advanced {
                ProductionWorkflowWorkspace()
            } else {
                Picker("Operation", selection: $selectedID) {
                    ForEach(WorkspaceRoute.allCases, id: \.self) { route in
                        Section(route.title) {
                            ForEach(RoadmapToolSchemas.commands.filter { $0.route == route }) { command in
                                Text(command.title).tag(command.id)
                            }
                        }
                    }
                }
                if let spec {
                    Text(spec.summary).foregroundStyle(.secondary)
                    DisclosureGroup("Request fields and schema from the shipped runtime") {
                        ScrollView {
                            Text(RoadmapToolSchemas.formatted(spec.registryTool ?? ""))
                                .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxHeight: 180)
                    }
                    Text("JSON request").font(.headline)
                    TextEditor(text: $requestJSON).font(.system(.body, design: .monospaced))
                        .frame(minHeight: 160, maxHeight: 250).border(.separator)
                        .accessibilityLabel("Tool JSON request")
                    if spec.conditionalSpend {
                        Button("Review selected step") { reviewStep() }.disabled(busy || !model.hasRuntime)
                        if let reviewedStep {
                            ScrollView {
                                Text(pretty(reviewedStep)).font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }.frame(maxHeight: 140)
                        }
                        if paidStep {
                            Text("This selected operation can spend money. Its invoice cost is not known here; the runtime enforces your ceiling.")
                                .foregroundStyle(.secondary)
                            Toggle("Approve spend for this invocation only", isOn: $approveSpend)
                            TextField("Spend ceiling (cents)", value: $ceilingCents, format: .number)
                                .frame(maxWidth: 300)
                        }
                    }
                    if spec.authorities.contains(.confirm) {
                        Toggle(spec.confirmationLabel, isOn: $confirmed)
                    }
                    if let message { Text(message).textSelection(.enabled).font(.callout) }
                    HStack {
                        Text("\(model.outputDirectory.path)").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Run once") { runOnce(spec) }.buttonStyle(.borderedProminent).disabled(!canRun)
                    }
                }
            }
        }
        .padding(24).frame(minWidth: 700, idealWidth: 800, minHeight: 580)
        .onChange(of: selectedID) { _, _ in requestJSON = "{}"; resetApproval(); message = nil }
        .onChange(of: requestJSON) { _, _ in resetApproval() }
        .onChange(of: advanced) { _, _ in resetApproval() }
    }

    private func resetApproval() { confirmed = false; approveSpend = false; reviewedStep = nil }
    private func pretty(_ value: JSONValue) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
    private func reviewStep() {
        let snapshot = requestJSON
        busy = true; resetApproval(); message = nil
        Task {
            defer { busy = false }
            do {
                let step = try await model.planRoadmapStep(request: RoadmapToolRequest(json: snapshot))
                guard snapshot == requestJSON, spec?.conditionalSpend == true else { return }
                reviewedStep = step
            } catch { message = error.localizedDescription }
        }
    }
    private func runOnce(_ spec: CommandSpec) {
        do {
            let request = try RoadmapToolRequest(json: requestJSON)
            let paidOperation = paidStep ? operation : nil
            var authorities: Set<Authority> = confirmed ? [.confirm] : []
            if paidStep && approveSpend { authorities.insert(.approveSpend) }
            let grant = authorities.isEmpty ? nil : ApprovalAuthorization.grantFromHumanApproval(
                ceilingCents: paidStep ? ceilingCents : 0, presentedEstimateCents: paidStep ? nil : 0,
                presentedConfidence: .estimated,
                presentedBasis: paidStep ? "Selected operation \(paidOperation ?? "unknown"); estimate not provided; explicit ceiling only." : "Local operation; no paid authority.",
                authorities: authorities)
            // Clear authority synchronously before any await. Another click always needs another decision.
            resetApproval(); busy = true; message = nil
            Task {
                defer { busy = false }
                do {
                    let id = try await model.runRoadmapTool(spec, request: request, grant: grant, paidOperation: paidOperation)
                    message = "Started \(id). Follow its result in Runs. Approval has been cleared."
                } catch { message = error.localizedDescription }
            }
        } catch { message = error.localizedDescription }
    }
}
