import AnvilKit
import SwiftUI

/// Runtime-owned, per-user configuration works from Finder without shell PATH assumptions.
struct OptionalToolsSettings: View {
    @Environment(AnvilModel.self) private var model
    @State private var selectedTool = "blender"
    @State private var executablePath = ""
    @State private var expectedSHA256 = ""
    @State private var report: JSONValue?
    @State private var message: String?
    @State private var checking = false
    @State private var activeRunID: RunID?
    private var activeRun: Run? { activeRunID.flatMap { model.runs[$0] } }
    private var busy: Bool { checking || activeRun?.state.isActive == true }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Optional tools").font(.title2.bold())
                Text("Choose executables explicitly. The runtime saves their locations and SHA-256 identities in your user configuration. File validation starts no external program; a saved path does not prove its version or behavior.")
                    .foregroundStyle(.secondary)
                Form {
                    Picker("Tool", selection: $selectedTool) {
                        Text("Blender").tag("blender")
                        Text("CPU Basis Universal").tag("basisu")
                        Text("Isolated CoACD Python").tag("coacd-python")
                    }
                    TextField("Absolute executable path", text: $executablePath)
                        .help("For Blender.app, use Contents/MacOS/Blender inside the application bundle.")
                    TextField("Expected SHA-256 (optional)", text: $expectedSHA256)
                        .font(.system(.body, design: .monospaced))
                }.formStyle(.columns).disabled(busy)
                HStack {
                    Button("Validate files and save") { mutate(clear: false) }
                        .disabled(busy || !model.hasRuntime || !executablePath.hasPrefix("/"))
                    Button("Clear saved selection") { mutate(clear: true) }.disabled(busy || !model.hasRuntime)
                    Spacer()
                    Button("Check selections") { refresh() }.disabled(busy || !model.hasRuntime)
                }
                if busy { ProgressView().controlSize(.small) }
                if let report {
                    if case let .array(tools)? = report["tools"] {
                        ForEach(tools.compactMap { $0["tool"]?.stringValue }, id: \.self) { id in
                            if let tool = tools.first(where: { $0["tool"]?.stringValue == id }) {
                                GroupBox(id) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(tool["detail"]?.stringValue ?? tool["code"]?.stringValue ?? "Unknown status")
                                        Text("Source: \(tool["source"]?.stringValue ?? "unknown")")
                                            .font(.caption).foregroundStyle(.secondary)
                                        if let identity = tool["identity"] { JSONEvidence(value: identity) }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                    }
                    if let path = report["configurationPath"]?.stringValue {
                        Text("Saved configuration: \(path)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                if let message { Text(message).font(.callout).textSelection(.enabled) }
            }
            .padding(24)
        }
        .task { refresh() }
        .onChange(of: activeRun?.state) { _, state in
            if state?.isTerminal == true {
                message = activeRun?.envelope?.summary ?? "Inspect the recorded run in Runs."
                refresh()
            }
        }
    }

    private func refresh() {
        guard !busy else { return }
        checking = true
        Task {
            defer { checking = false }
            do { report = try await model.inspectOptionalTools() }
            catch { message = error.localizedDescription }
        }
    }
    private func mutate(clear: Bool) {
        guard !busy, let spec = CommandCatalog[clear ? "tool.clear" : "tool.configure"] else { return }
        var arguments = [selectedTool]
        if !clear {
            guard executablePath.hasPrefix("/"), !executablePath.contains("\0") else { return }
            arguments += ["--executable", executablePath]
            if !expectedSHA256.isEmpty {
                guard expectedSHA256.count == 64, expectedSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
                    message = "Expected SHA-256 must contain 64 lowercase hexadecimal characters."; return
                }
                arguments += ["--sha256", expectedSHA256]
            }
        }
        let grant = ApprovalAuthorization.grantFromHumanApproval(
            ceilingCents: 0, presentedEstimateCents: 0, presentedConfidence: .estimated,
            presentedBasis: clear ? "Clear the selected saved tool path." : "Save the entered optional tool executable after file identity validation.",
            authorities: [.confirm])
        do {
            activeRunID = try model.runs.start(spec, arguments: arguments, outputDirectory: model.outputDirectory, grant: grant)
            message = nil
        } catch { message = error.localizedDescription }
    }
}
