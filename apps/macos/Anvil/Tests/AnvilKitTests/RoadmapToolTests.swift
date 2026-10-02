import Foundation
import Testing
@testable import AnvilKit

@Suite("Roadmap tool requests")
struct RoadmapToolTests {
    @Test("Only bounded JSON objects can enter the tool request pipe")
    func requestValidation() throws {
        #expect(try RoadmapToolRequest(json: "{\"recipeId\":\"sample\"}").data == Data("{\"recipeId\":\"sample\"}".utf8))
        #expect(throws: (any Error).self) { try RoadmapToolRequest(json: "[]") }
        #expect(throws: (any Error).self) { try RoadmapToolRequest(json: "not JSON") }
        #expect(throws: (any Error).self) { try RoadmapToolRequest(json: "{\"text\":\"" + String(repeating: "x", count: 1_048_576) + "\"}") }
    }

    @Test("Review binds the selected leaf, fingerprint, readiness and paid classification")
    func selectedStepMustMatch() throws {
        let request = try RoadmapToolRequest(json: "{\"recipeId\":\"sample\",\"stepId\":\"generate\",\"approvedFingerprint\":\"current\"}")
        var step: [String: JSONValue] = ["id": .string("generate"), "operation": .string("create_3d_asset"),
            "status": .string("ready"), "fingerprint": .string("current"), "paid": .bool(true)]
        func plan() -> JSONValue { .object(["id": .string("sample"), "steps": .array([.object(step)])]) }
        #expect(try request.selectedStep(in: plan())["operation"]?.stringValue == "create_3d_asset")
        step["fingerprint"] = .string("changed")
        #expect(throws: (any Error).self) { try request.selectedStep(in: plan()) }
        step["fingerprint"] = .string("current"); step["status"] = .string("uncertain")
        #expect(throws: (any Error).self) { try request.selectedStep(in: plan()) }
        step["status"] = .string("ready"); step["paid"] = .bool(false)
        #expect(throws: (any Error).self) { try request.selectedStep(in: plan()) }
    }

    @Test("A recipe wrapper gets spend only from the current explicit grant")
    func conditionalSpendIsPerInvocation() throws {
        let spec = try #require(CommandCatalog.byRegistryTool["run_production_step"])
        #expect(spec.conditionalSpend)
        #expect(!spec.spend.isPaid)
        let confirmation = ApprovalAuthorization.grantFromHumanApproval(
            ceilingCents: 0, presentedEstimateCents: 0, presentedConfidence: .estimated,
            presentedBasis: "Local step", authorities: [.confirm])
        let paid = ApprovalAuthorization.grantFromHumanApproval(
            ceilingCents: 50, presentedEstimateCents: nil, presentedConfidence: .estimated,
            presentedBasis: "Selected paid step; estimate unknown", authorities: [.confirm, .approveSpend])
        func argv(_ grant: ApprovalGrant?) throws -> [String] {
            try RunStore.commandLine(for: spec, arguments: ["--request", "-"],
                outputDirectory: URL(fileURLWithPath: "/tmp/example"), grant: grant)
        }
        #expect(try !argv(confirmation).contains("--approve-spend"))
        #expect(ApprovalRecord(paid).presentedEstimateCents == nil)
        let approved = try argv(paid)
        #expect(approved.contains("--confirm"))
        #expect(approved.contains("--approve-spend"))
        let ceiling = try #require(approved.firstIndex(of: "--spend-limit-cents"))
        #expect(approved[ceiling + 1] == "50")
        // The next invocation must not inherit authority from the preceding one.
        #expect(try !argv(nil).contains("--approve-spend"))
        #expect(try !argv(nil).contains("--confirm"))
    }

    @Test("RunStore delivers the JSON request on stdin to a mock runtime")
    @MainActor
    func requestReachesMockRuntime() async throws {
        let runtime = try makeClosedRuntimeFixture(body: """
        received=$(/bin/cat)
        if [ "$received" != '{"recipeId":"sample"}' ]; then exit 12; fi
        printf '%s\\n' '{"schema":"game_dev.result.v1","operation":"tool.plan_production_recipe","ok":true,"data":{"received":true}}'
        """)
        let logRoot = FileManager.default.temporaryDirectory.appendingPathComponent("anvil-tool-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime); try? FileManager.default.removeItem(at: logRoot) }
        let store = RunStore(client: GameDevCLIClient(executableURL: runtime), log: RunLog(root: logRoot))
        let spec = CommandSpec(id: "tool.plan_production_recipe", path: ["tool", "call", "plan_production_recipe"],
            title: "Plan", summary: "Mock", route: .createBrief, registryTool: "plan_production_recipe")
        let id = try store.start(spec, arguments: ["--request", "-"], outputDirectory: logRoot,
            standardInput: RoadmapToolRequest(json: "{\"recipeId\":\"sample\"}").data)
        for _ in 0..<500 {
            if store[id]?.state.isActive == false { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(store[id]?.envelope?.data["received"] == .bool(true))
        #expect(store[id]?.arguments.contains("--approve-spend") == false)
    }
}
