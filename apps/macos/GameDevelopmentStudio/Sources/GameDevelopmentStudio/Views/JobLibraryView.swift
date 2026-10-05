import SwiftUI

struct DurableJobModel: Decodable, Identifiable { let id: String; let operation: String; let status: String }
struct JobListModel: Decodable { let durable: [DurableJobModel] }
struct JobLibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var selected = ""
    @State private var ceiling = 100
    @State private var approval: ApprovalRequest?
    private var jobs: [DurableJobModel] { model.operationResults["job.list"]?.data.decoded(JobListModel.self)?.durable ?? [] }
    private var job: DurableJobModel? { jobs.first { $0.id == selected } }
    var body: some View {
        MaterialCard(title: "Durable jobs", systemImage: "clock.arrow.circlepath") {
            Button("Refresh Jobs") { Task { await model.listJobs() } }.disabled(model.executionState.isRunning)
            Picker("Job", selection: $selected) {
                Text("Select a job").tag("")
                ForEach(jobs) { Text("\($0.operation) · \($0.status) · \($0.id)").tag($0.id) }
            }
            HStack {
                Button("Inspect Job") { Task { await model.showJob(selected) } }.disabled(selected.isEmpty)
                TextField("Fresh spend ceiling (US cents)", value: $ceiling, format: .number).frame(maxWidth: 240)
                Button("Resume Job…") { Task { await resume() } }
                    .disabled(job == nil || ["running", "completed", "cancelled"].contains(job?.status ?? "") || ceiling <= 0)
            }.disabled(model.executionState.isRunning)
            if let result = model.operationResults["job.show"] { ResultSummaryView(result: result) }
            Text("Resume is a new invocation. Paid work needs fresh approval and may incur another charge.").font(.caption).foregroundStyle(.secondary)
        }.sheet(item: $approval) { ApprovalSheet(request: $0) }
    }
    private func resume() async {
        guard let job, let identity = await model.executableIdentityForApproval() else { return }
        let provider = job.operation.split(separator: ".").dropFirst().first.flatMap { CredentialProvider(rawValue: String($0)) }
        // Only provider and known non-provider jobs can be resumed through this surface.
        guard !job.operation.hasPrefix("provider.") || provider != nil else { return }
        let amount = ceiling, output = model.outputDirectory
        var arguments = ["job", "resume", job.id, "--confirm"]
        if provider != nil { arguments += ["--approve-spend", "--spend-limit-cents", String(amount)] }
        let invocation = arguments
        approval = ApprovalRequest(title: "Resume job once", summary: "Retry the durable operation shown below. Previously granted execution authorities are not reused.",
                                   details: ["Job: \(job.id)", "Operation: \(job.operation)", "Spend ceiling: \(amount) US cents"] + identity.approvalDetails,
                                   authorities: provider == nil ? [.processExecution] : [.providerSpend], confirmationTitle: "Resume Once") {
            await model.runReviewedOperation(arguments: invocation, identity: identity, output: output, providers: provider.map { Set([$0]) } ?? [])
        }
    }
}
