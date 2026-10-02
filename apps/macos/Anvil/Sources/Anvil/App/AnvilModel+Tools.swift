import AnvilKit
import Foundation

extension AnvilModel {
    /// Only the UI's current click supplies a grant; no ledger or saved run can supply one.
    func runRoadmapTool(_ spec: CommandSpec, request: RoadmapToolRequest,
                        grant: ApprovalGrant?, paidOperation: String?) async throws -> RunID {
        var credentials: [CredentialProvider: String] = [:]
        if grant?.authorities.contains(.approveSpend) == true {
            let provider: CredentialProvider = paidOperation == "generate_asset_reference" ? .leonardo : .tripo
            if let credential = try await KeychainCredentialStore().credential(for: provider) {
                credentials[provider] = credential
            }
        }
        return try runs.start(spec, arguments: ["--request", "-"], outputDirectory: outputDirectory,
                              credentials: credentials, standardInput: request.data, grant: grant)
    }

    func planRoadmapStep(request: RoadmapToolRequest) async throws -> JSONValue {
        let body = try JSONDecoder().decode(JSONValue.self, from: request.data)
        guard let recipeID = body["recipeId"]?.stringValue else {
            throw GameDevCLIClientError.invalidInvocation("Enter recipeId, stepId and approvedFingerprint from the current recipe plan.")
        }
        let data = try JSONEncoder().encode(["recipeId": recipeID])
        let result = try await execute(CLIInvocation(
            arguments: ["tool", "call", "plan_production_recipe", "--request", "-", "--output-dir", outputDirectory.path, "--json"],
            standardInput: data, expectedOperation: "tool.plan_production_recipe"), timeout: .seconds(30))
        guard result.envelope.ok else {
            throw GameDevCLIClientError.invalidInvocation(result.envelope.summary)
        }
        return try request.selectedStep(in: result.envelope.data)
    }
}
