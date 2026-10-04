import Foundation
import Testing
@testable import AnvilKit

@Suite("Guided production workflows")
struct ProductionWorkflowTests {
    private func draft(_ template: ProductionWorkflowDraft.Template = .inspect) -> ProductionWorkflowDraft {
        var value = ProductionWorkflowDraft()
        value.template = template; value.recipeID = "sample-workflow"; value.name = "Sample asset"
        value.license = "CC0-1.0"; value.modelPath = "/tmp/Assets with spaces/source.glb"
        return value
    }
    private func step(status: String = "ready", state: String = "ready", fingerprint: String = String(repeating: "a", count: 64), paid: JSONValue = .bool(false)) -> JSONValue {
        .object(["id": .string("inspect"), "operation": .string("inspect_asset"), "status": .string(status),
                 "state": .string(state), "fingerprint": .string(fingerprint), "paid": paid,
                 "arguments": .object(["modelPath": .string("/tmp/Assets with spaces/source.glb")]),
                 "reasons": .array([.string("Current file identity verified.")]),
                 "evidence": .object(["result": .object(["filePath": .string("/tmp/actual.glb")])])])
    }
    private func plan(_ steps: [JSONValue], id: String = "sample-workflow") -> JSONValue {
        .object(["schema": .string("game_dev.recipe_plan.v1"), "id": .string(id), "steps": .array(steps)])
    }

    @Test("Forms preserve paths with spaces and never carry authorization")
    func formRequest() throws {
        let value = try draft().request()
        #expect(value["templateId"]?.stringValue == "inspect-validate-package")
        #expect(value["request"]?["modelPath"]?.stringValue == "/tmp/Assets with spaces/source.glb")
        #expect(value["request"]?["approveSpend"] == nil)
        #expect(value["request"]?["approvedFingerprint"] == nil)
        let body = try RoadmapToolRequest(value: value)
        #expect(try JSONDecoder().decode(JSONValue.self, from: body.data) == value)
    }

    @Test("Malformed form values fail before a mutation is requested")
    func malformedForms() throws {
        var value = draft()
        value.recipeID = "../other-workspace"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(); value.modelPath = "relative.glb"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(); value.modelPath = "/tmp/source.blend"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(); value.modelPath = "/tmp/source.gltf"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(); value.license = "  "
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(.platform); value.lodTriangles = "10000,not-a-budget"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(.platform); value.lodTriangles = "10000,"
        #expect(throws: (any Error).self) { try value.request() }
        value = draft(.platform); value.maxTextureSize = 20000
        #expect(throws: (any Error).self) { try value.request() }
    }

    @Test("Review forms use different local GLB candidates without fabricating candidate IDs")
    func reviewForms() throws {
        var value = draft(.review)
        value.candidatePaths = "/tmp/first candidate.glb\n/tmp/second.glb"
        let request = try value.request()
        guard case let .array(candidates)? = request["request"]?["candidates"] else { Issue.record("Missing candidates"); return }
        #expect(candidates.count == 2)
        #expect(candidates.allSatisfy { $0["id"] == nil })
        value.candidatePaths = "/tmp/repeated.glb\n/tmp/repeated.glb"
        #expect(throws: (any Error).self) { try value.request() }
        value.candidatePaths = "/tmp/unsupported.gltf"
        #expect(throws: (any Error).self) { try value.request() }
    }

    @Test("Appearance and pose settings are explicit, bounded and part of the saved request")
    func reviewSettings() throws {
        var value = draft(.review)
        value.candidatePaths = "/tmp/animated.glb"
        value.reviewMode = "appearance"; value.reviewExposure = 1.5; value.reviewLod = "LOD 1"
        value.sampleAnimation = true; value.clipIndex = 2; value.clipTimeSeconds = 0.75
        let settings = try value.request()["request"]?["reviewSettings"]
        #expect(settings?["mode"] == .string("appearance"))
        #expect(settings?["pose"]?["clipIndex"] == .number(2))
        #expect(settings?["pose"]?["timeSeconds"] == .number(0.75))
        #expect(settings?["reviewLod"] == .string("LOD 1"))
        value.reviewExposure = .nan
        #expect(throws: (any Error).self) { try value.request() }
        value.reviewExposure = 1; value.clipTimeSeconds = -1
        #expect(throws: (any Error).self) { try value.request() }
        value.clipTimeSeconds = 0; value.reviewResolution = 4096
        #expect(throws: (any Error).self) { try value.request() }
    }

    @Test("Actual recipe states, reasons and result paths are preserved")
    func actualEvidence() throws {
        let current = try ProductionPlan(plan([step(status: "complete", state: "completed")]))
        let selected = try #require(current.steps.first)
        #expect(selected.state == .completed)
        #expect(selected.reasons == ["Current file identity verified."])
        #expect(selected.evidence?["result"]?["filePath"]?.stringValue == "/tmp/actual.glb")
        #expect(throws: (any Error).self) { try selected.executionRequest(recipeID: current.recipeID) }
    }

    @Test("Stale, uncertain, unknown and incomplete metadata cannot authorize a step")
    func failsClosed() throws {
        for value in [step(status: "uncertain", state: "uncertain"), step(status: "blocked", state: "blocked"),
                      step(fingerprint: "not-a-digest"), step(paid: .null), step(paid: .bool(true))] {
            let current = try ProductionStep(value)
            #expect(throws: (any Error).self) { try current.executionRequest(recipeID: "sample-workflow") }
        }
        let selected = try ProductionStep(step())
        let request = try selected.executionRequest(recipeID: "sample-workflow")
        #expect(throws: (any Error).self) { try request.selectedStep(in: plan([step(fingerprint: String(repeating: "b", count: 64))])) }
        #expect(throws: (any Error).self) { try request.selectedStep(in: plan([step()], id: "different-workflow")) }
        let unknown = try ProductionStep(.object(["id": .string("future"), "operation": .string("future_operation"),
            "status": .string("ready"), "state": .string("ready"), "paid": .bool(false), "fingerprint": .string(String(repeating: "a", count: 64))]))
        #expect(throws: (any Error).self) { try unknown.executionRequest(recipeID: "sample-workflow") }
    }

    @Test("Invalidated steps need a fresh ready fingerprint; old completion evidence grants nothing")
    func invalidatedReview() throws {
        let current = try ProductionStep(step(status: "ready", state: "invalidated"))
        #expect(current.state == .invalidated)
        let request = try current.executionRequest(recipeID: "sample-workflow")
        #expect(try request.selectedStep(in: plan([step(status: "ready", state: "invalidated")]))["id"]?.stringValue == "inspect")
        let invalidInput = try ProductionStep(step(status: "invalid", state: "invalidated"))
        #expect(throws: (any Error).self) { try invalidInput.executionRequest(recipeID: "sample-workflow") }
    }

    @Test("Unsupported and ambiguous plans never populate runnable UI rows")
    func malformedPlans() throws {
        #expect(throws: (any Error).self) { try ProductionPlan(.object(["schema": .string("future-plan"), "id": .string("sample"), "steps": .array([])])) }
        #expect(throws: (any Error).self) { try ProductionPlan(plan([step(), step()])) }
        #expect(throws: (any Error).self) { try ProductionPlan(plan([.object(["id": .string("partial")])])) }
    }

    @Test("Native form values expand through the actual built runtime templates without executing steps")
    func builtRuntimeTemplateContract() async throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let entrypoint = repository.appendingPathComponent("dist/cli.js")
        guard FileManager.default.fileExists(atPath: entrypoint.path) else {
            withKnownIssue("Build dist/cli.js before the actual-runtime template contract check.") { Issue.record("CLI not built") }
            return
        }
        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent("anvil-template-contract-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: workspace) }
        let client = GameDevCLIClient(executableURL: URL(fileURLWithPath: "/usr/bin/env"))
        for template in ProductionWorkflowDraft.Template.allCases {
            var values = draft(template)
            values.candidatePaths = "/tmp/first candidate.glb\n/tmp/second.glb"
            values.reviewMode = "appearance"; values.reviewLod = "LOD 0"
            let request = try RoadmapToolRequest(value: values.request())
            // This is an actual read-only runtime invocation. No registered workflow step runs.
            let result = try await client.execute(CLIInvocation(
                arguments: ["node", entrypoint.path, "tool", "call", "plan_production_template", "--request", "-",
                            "--output-dir", workspace.path, "--json"],
                standardInput: request.data, expectedOperation: "tool.plan_production_template"),
                credentials: [:], timeout: .seconds(30))
            #expect(result.envelope.ok)
            #expect(result.envelope.data["schema"]?.stringValue == "game_dev.production_template_plan.v1")
            #expect(result.envelope.data["template"]?["id"]?.stringValue == template.rawValue)
            #expect(result.envelope.data["recipe"]?["id"]?.stringValue == values.recipeID)
            #expect(result.envelope.data["executes"] == .bool(false))
            if template == .review, case let .array(steps)? = result.envelope.data["recipe"]?["steps"] {
                let settings = steps.first?["arguments"]?["settings"]
                #expect(settings?["mode"] == .string("appearance"))
                #expect(settings?["reviewLod"] == .string("LOD 0"))
            }
        }
    }
}
