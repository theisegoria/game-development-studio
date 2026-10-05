import SwiftUI
import Charts

struct OptimizationSessionView: View {
    @Environment(AppModel.self) private var model
    let baseline: String
    @AppStorage("studio.optimization.project") private var project = ""
    @AppStorage("studio.optimization.scenario") private var scenario = "capture"
    @AppStorage("studio.optimization.directory") private var sessionDirectory = ""
    @AppStorage("studio.optimization.root") private var sessionRoot = ""
    @State private var metric = "render.frame_time"
    @State private var unit = "ms"
    @State private var target = 8.0
    @State private var direction = "lower"
    @State private var statistic = "median"
    @State private var iterations = 3
    @State private var paths = "src"
    @State private var parameters = "{}"
    @State private var buildExecutable = "/usr/bin/make"
    @State private var buildArguments = ""
    @State private var testExecutable = "/usr/bin/make"
    @State private var testArguments = "test"
    @State private var visualLimit = 0.0
    @State private var exportPath = ""
    @State private var gpu = false
    @State private var performance = false
    @State private var approvedPlanSignature: String?
    @State private var approval: ApprovalRequest?
    private var request: JSONValue? {
        guard let bytes = parameters.data(using: .utf8), let params = try? JSONDecoder().decode(JSONValue.self, from: bytes), case .object = params else { return nil }
        func command(_ executable: String, _ arguments: String) -> JSONValue {
            .object(["executable": .string(executable), "arguments": .array(arguments.split(separator: "\n").map { .string(String($0)) })])
        }
        return .object(["scenarioId": .string(scenario), "parameters": params, "metric": .string(metric), "unit": .string(unit),
                        "target": .number(target), "direction": .string(direction), "statistic": .string(statistic), "maximumIterations": .number(Double(iterations)),
                        "allowedPaths": .array(paths.split(separator: "\n").map { .string(String($0)) }),
                        "build": command(buildExecutable, buildArguments), "tests": .array([command(testExecutable, testArguments)]),
                        "maximumChangedPixelRatio": .number(visualLimit)])
    }
    private var signature: String { "\(project)|\(baseline)|\(sessionRoot)|\(model.outputDirectory)|\(model.cliExecutable)|\(String(describing: request))" }
    private var session: OptimizationSessionModel? {
        return ["optimization.evaluate", "optimization.status", "optimization.start", "optimization.stop", "optimization.recover"].compactMap { model.operationResults[$0] }.sorted { $0.receivedAt > $1.receivedAt }.compactMap { $0.data.decoded(OptimizationSessionModel.self) }.first { $0.directory == sessionDirectory }
    }
    var body: some View {
        MaterialCard(title: "Bounded agent optimization", systemImage: "scope") {
            Text("An external coding agent edits an isolated checkout. Studio verifies the candidate and prepares a patch for your review.").foregroundStyle(.secondary)
            Grid(alignment: .leading) {
                GridRow { Text("Project"); TextField("Source checkout", text: $project) }
                GridRow { Text("Scenario"); TextField("Scenario identifier", text: $scenario) }
                GridRow { Text("Metric / unit"); HStack { TextField("Metric", text: $metric); TextField("Unit", text: $unit) } }
                GridRow { Text("Target"); TextField("Target value", value: $target, format: .number) }
                GridRow { Text("Direction"); Picker("Direction", selection: $direction) { Text("Lower is better").tag("lower"); Text("Higher is better").tag("higher") }.labelsHidden() }
                GridRow { Text("Statistic"); Picker("Statistic", selection: $statistic) { ForEach(["min", "max", "mean", "median", "p95", "p99"], id: \.self) { Text($0).tag($0) } }.labelsHidden() }
                GridRow { Text("Attempts"); Stepper("\(iterations)", value: $iterations, in: 1...50) }
                GridRow { Text("Visual change limit"); HStack { Slider(value: $visualLimit, in: 0...1); Text(visualLimit, format: .percent) } }
                GridRow { Text("Session storage"); TextField("Directory outside the source project", text: $sessionRoot) }
            }.textFieldStyle(.roundedBorder)
            DisclosureGroup("Source paths, scenario parameters, build and tests") {
                Text("One source path or argument per line. Commands run directly without shell expansion.").font(.caption)
                Text("Allowed source paths").font(.caption)
                TextEditor(text: $paths).frame(height: 50)
                Text("Scenario parameters (JSON object)").font(.caption)
                TextEditor(text: $parameters).frame(height: 60)
                TextField("Build executable", text: $buildExecutable)
                TextEditor(text: $buildArguments).frame(height: 45)
                TextField("Test executable", text: $testExecutable)
                TextEditor(text: $testArguments).frame(height: 45)
            }
            HStack {
                Button("Plan Optimization") { Task { await plan() } }
                Button("Create Isolated Session…") { Task { await start() } }
                    .disabled(approvedPlanSignature != signature || model.operationResults["optimization.plan"]?.ok != true)
            }.disabled(request == nil || project.isEmpty || baseline.isEmpty || sessionRoot.isEmpty || model.executionState.isRunning)
            Divider()
            TextField("Existing session directory", text: $sessionDirectory).textFieldStyle(.roundedBorder)
            HStack {
                Button("Refresh Session") { Task { await model.inspectOperation(arguments: ["optimization", "status", sessionDirectory]) } }
                Toggle("GPU", isOn: $gpu)
                Toggle("Hardware performance", isOn: $performance)
            }
            HStack {
                Button("Evaluate Candidate…") { Task { await action("evaluate") } }.disabled(session?.status != "active")
                Button("Recover Interrupted Session…") { Task { await action("recover") } }
                Button("Stop Session…") { Task { await action("stop") } }
            }.disabled(sessionDirectory.isEmpty || model.executionState.isRunning)
            if let session {
                Text("\(session.status.capitalized) · \(session.attempts.count) attempts").font(.headline)
                Text("Agent checkout: \(session.checkout)").font(.caption).textSelection(.enabled)
                if !session.attempts.isEmpty {
                    Chart(session.attempts) { attempt in
                        if let value = attempt.value { PointMark(x: .value("Attempt", attempt.number), y: .value(session.plan.request.unit, value)).foregroundStyle(by: .value("Status", attempt.status)) }
                        RuleMark(y: .value("Target", session.plan.request.target)).lineStyle(StrokeStyle(dash: [4]))
                    }.frame(height: 150)
                }
                ForEach(session.attempts) { attempt in
                    Text("Attempt \(attempt.number): \(attempt.status)\(attempt.targetMet == true ? " · target met" : "") \(attempt.error ?? "")").font(.caption).textSelection(.enabled)
                }
            }
            HStack {
                TextField("New patch-review export directory", text: $exportPath)
                Button("Export Best Patch…") { Task { await action("export") } }.disabled(exportPath.isEmpty || sessionDirectory.isEmpty)
            }
        }
        .sheet(item: $approval) { ApprovalSheet(request: $0) }
        .onChange(of: signature) { _, _ in approvedPlanSignature = nil }
        .onChange(of: model.operationResults["optimization.start"]?.id) { _, _ in
            if let directory = model.operationResults["optimization.start"]?.data["directory"]?.stringValue { sessionDirectory = directory }
        }
    }
    private func plan() async {
        guard let request else { return }; let current = signature
        await model.inspectOperation(arguments: ["optimization", "plan", baseline, "--project", project, "--request", "-"], request: request)
        if model.operationResults["optimization.plan"]?.ok == true && signature == current { approvedPlanSignature = current }
    }
    private func start() async {
        guard approvedPlanSignature == signature, let request,
              let hash = model.operationResults["optimization.plan"]?.data["planHash"]?.stringValue else { return }
        await approve(arguments: ["optimization", "start", baseline, "--project", project, "--request", "-", "--session-root", sessionRoot, "--plan-hash", hash, "--confirm"], request: request,
                      summary: "Snapshot the reviewed source into an isolated checkout. No candidate is executed yet.")
    }
    private func action(_ name: String) async {
        var args = ["optimization", name, sessionDirectory, "--confirm"]
        if name == "evaluate" { if gpu { args.append("--allow-gpu") }; if performance { args.append("--allow-performance") } }
        if name == "export" { args += ["--output", exportPath] }
        await approve(arguments: args, summary: name == "evaluate" ? "Build, test, capture, and evaluate this candidate once with the selected authorities." : "Perform this session operation once. Exporting does not apply the patch.")
    }
    private func approve(arguments: [String], request: JSONValue? = nil, summary: String) async {
        guard let identity = await model.executableIdentityForApproval() else { return }
        let output = model.outputDirectory
        var authorities: [ApprovalAuthority] = [.processExecution]
        if arguments.contains("--allow-gpu") { authorities.append(.gpuCapture) }
        if arguments.contains("--allow-performance") { authorities.append(.performanceMeasurement) }
        approval = ApprovalRequest(title: "Review optimization operation", summary: summary,
            details: arguments + ["Request: \(String(describing: request))"] + identity.approvalDetails,
            authorities: authorities, confirmationTitle: "Confirm Once") {
            await model.runReviewedOperation(arguments: arguments, request: request, identity: identity, output: output)
        }
    }
}
