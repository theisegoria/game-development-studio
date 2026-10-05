import SwiftUI

struct PerformanceWorkspaceView: View {
    @Environment(AppModel.self) private var model

    @AppStorage("studio.performance.runReference") private var runReference = ""
    @AppStorage("studio.performance.baselineReference") private var baselineReference = ""
    @AppStorage("studio.performance.candidateReference") private var candidateReference = ""
    @State private var statistic = "median"

    private let statistics = ["min", "max", "mean", "median", "p95", "p99"]

    var body: some View {
        WorkspaceScaffold(section: .performance) {
            RunLibraryView(selectRun: { runReference = $0 }, selectBaseline: { baselineReference = $0 }, selectCandidate: { candidateReference = $0 })
            MaterialCard(title: "Summarize a sealed run", systemImage: "chart.bar.doc.horizontal") {
                TextField("Run ID or path", text: $runReference)
                    .textFieldStyle(.roundedBorder)

                FormActions {
                    Button("Summarize Metrics") {
                        Task { await model.summarizePerformance(reference: runReference) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(runReference.isEmpty || model.executionState.isRunning)
                }
            }

            MaterialCard(title: "Compare measurements", systemImage: "gauge.open.with.lines.needle.33percent") {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 12) {
                    GridRow {
                        Text("Baseline")
                        TextField("Baseline run ID or path", text: $baselineReference)
                    }

                    GridRow {
                        Text("Candidate")
                        TextField("Candidate run ID or path", text: $candidateReference)
                    }

                    GridRow {
                        Text("Statistic")
                        Picker("Statistic", selection: $statistic) {
                            ForEach(statistics, id: \.self) { value in
                                Text(value.uppercased()).tag(value)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 180, alignment: .leading)
                    }
                }
                .textFieldStyle(.roundedBorder)

                FormActions {
                    Button("Compare Performance") {
                        Task {
                            await model.comparePerformance(
                                baseline: baselineReference,
                                candidate: candidateReference,
                                stat: statistic
                            )
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canCompare || model.executionState.isRunning)
                }

                EvidenceNote(text: "This view proves deterministic arithmetic over admitted telemetry. Hardware comparability, timer quality, statistical significance, and causal attribution remain separate claims.")
            }

            if let summary = model.operationResults["performance.summarize"]?.data.decoded(PerformanceModel.self) {
                PerformanceChartsView(summary: summary)
            }
            if let comparison = model.operationResults["performance.compare"]?.data.decoded(PerformanceComparisonModel.self) {
                PerformanceDeltaView(comparison: comparison)
            }
            OptimizationSessionView(baseline: baselineReference)

            MaterialCard(title: "Hardware capture authority", systemImage: "lock.shield") {
                Text("Hardware timings are admitted only by a scenario that explicitly declares performance capture. Use Visual Debugging to plan that scenario; its approval sheet grants process, GPU, and performance authority independently for one run.")
                    .foregroundStyle(.secondary)

                Button("Open Visual Debugging") {
                    model.selectedWorkspace = .visualDebugging
                }
                .accessibilityHint("Moves to the scenario planning workspace")
            }

            WorkspaceResultCard(
                result: model.latestResult,
                emptyTitle: "No performance evidence",
                emptyDescription: "Summarize a sealed run or compare two comparable runs."
            )
        }
    }

    private var canCompare: Bool {
        !baselineReference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !candidateReference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
