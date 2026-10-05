import SwiftUI
struct PackageLibraryView: View {
    @Environment(AppModel.self) private var model
    @Binding var selected: String
    @State private var approval: ApprovalRequest?
    private var assets: [JSONValue] { model.operationResults["catalog.list"]?.data["assets"]?.arrayValue ?? [] }
    var body: some View {
        MaterialCard(title: "Packages and previews", systemImage: "shippingbox") {
            ForEach(Array(assets.enumerated()), id: \.offset) { entry in
                let asset = entry.element
                let reference = asset["packageId"]?.stringValue ?? asset["id"]?.stringValue ?? ""
                HStack {
                    VStack(alignment: .leading) {
                        Text(asset["name"]?.stringValue ?? reference).font(.headline)
                        Text(asset["license"]?.stringValue ?? "License unavailable").font(.caption)
                    }
                    Spacer()
                    Button("Select") { selected = reference }
                }
            }
            HStack {
                Button("Verify Selected Package") { Task { await model.verifyPackage(selected) } }
                Button("Quick Look…") { Task { await preview("quicklook") } }
                Button("Reveal in Finder…") { Task { await preview("finder") } }
            }.disabled(selected.isEmpty || model.executionState.isRunning)
            if let result = model.operationResults["package.verify"] { ResultSummaryView(result: result) }
            if let receipt = model.operationResults["vendor.admit"], receipt.data["dryRun"]?.boolValue == false {
                ResultSummaryView(result: receipt)
            }
        }.sheet(item: $approval) { ApprovalSheet(request: $0) }
    }
    private func preview(_ application: String) async {
        let reference = selected
        await model.inspectOperation(arguments: ["launch", reference, "--with", application])
        guard model.latestResult?.ok == true, let identity = await model.executableIdentityForApproval() else { return }
        let output = model.outputDirectory
        approval = ApprovalRequest(title: "Open package preview", summary: "Launch the selected local viewer once.",
            details: ["Package: \(reference)", "Viewer: \(application)"] + identity.approvalDetails,
            authorities: [.processExecution], confirmationTitle: "Open Once") {
            await model.runReviewedOperation(arguments: ["launch", reference, "--with", application, "--confirm"], identity: identity, output: output)
        }
    }
}
