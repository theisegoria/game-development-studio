import SwiftUI

struct RunLibraryView: View {
    @Environment(AppModel.self) private var model
    let selectRun: (String) -> Void
    let selectBaseline: (String) -> Void
    let selectCandidate: (String) -> Void
    var body: some View {
        MaterialCard(title: "Run library", systemImage: "square.stack.3d.up") {
            Button("Refresh Runs") { Task { await model.refreshRuns() } }
                .disabled(model.executionState.isRunning)
            if let library = model.operationResults["capture.list"]?.data.decoded(RunLibrary.self) {
                if library.runs.isEmpty { Text("No sealed runs in this workspace.").foregroundStyle(.secondary) }
                ForEach(library.runs) { run in
                    HStack {
                        Image(systemName: run.verified ? "checkmark.shield" : "exclamationmark.triangle")
                        VStack(alignment: .leading) {
                            Text(run.scenario ?? run.id).font(.headline)
                            Text(run.error ?? "\(run.outcome ?? "") · \(run.evidence ?? "") · \(run.completedAt ?? "")")
                                .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        Spacer()
                        Button("Inspect") { selectRun(run.path) }
                        Button("Baseline") { selectBaseline(run.path) }
                        Button("Candidate") { selectCandidate(run.path) }
                    }
                    .disabled(!run.verified || model.executionState.isRunning)
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

struct ScenarioParametersView: View {
    let definitions: [String: ScenarioParameter]
    @Binding var values: [String: String]
    var body: some View {
        ForEach(definitions.keys.sorted(), id: \.self) { key in
            if let definition = definitions[key] {
                HStack {
                    Text(key + (definition.required == true ? " *" : ""))
                    if let choices = definition.values {
                        Picker(key, selection: binding(key)) {
                            Text("Default").tag("")
                            ForEach(choices, id: \.self) { Text($0).tag($0) }
                        }.labelsHidden()
                    } else {
                        TextField(definition.type == "integer" ? "Integer" : "Value or project-relative path", text: binding(key))
                            .textFieldStyle(.roundedBorder)
                    }
                }
                .help(definition.description ?? definition.type)
            }
        }
    }
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }
}
