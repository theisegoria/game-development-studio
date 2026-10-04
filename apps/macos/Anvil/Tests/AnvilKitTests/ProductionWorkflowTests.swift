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
    private func animationClip(
        _ index: Int,
        name: String,
        duration: Double,
        channels: Int = 2,
        interpolation: [String] = ["LINEAR"],
        supported: Bool = true
    ) -> JSONValue {
        .object(["index": .number(Double(index)), "name": .string(name), "durationSeconds": .number(duration),
                 "channels": .number(Double(channels)), "interpolation": .array(interpolation.map(JSONValue.string)), "supported": .bool(supported)])
    }
    private func animationInfo(
        path: String,
        clips: [JSONValue],
        digest: String = String(repeating: "c", count: 64)
    ) -> JSONValue {
        .object(["schema": .string("game_dev.animation_review_info.v1"), "modelPath": .string(path),
                 "sourceSha256": .string(digest),
                 "renderer": .object(["id": .string("gds-cpu-review"), "version": .string("2.1.0"), "lighting": .string("neutral-studio-v1")]),
                 "clips": .array(clips),
                 "framing": .object(["policy": .string("default-pose")]), "warnings": .array([])])
    }
    private func repositoryDirectory() -> URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }
    private func builtRuntimeEntrypoint() -> URL { repositoryDirectory().appendingPathComponent("dist/cli.js") }
    private func writeAnimatedGLBFixture(at path: URL, name: String, duration: Double, interpolation: String) throws {
        let source = #"""
            import { Document, NodeIO } from '@gltf-transform/core';
            const [file, name, durationText, interpolation] = process.argv.slice(1);
            const duration = Number(durationText);
            const doc = new Document();
            const buffer = doc.createBuffer();
            const positions = doc.createAccessor('positions').setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0]));
            const node = doc.createNode('animated triangle').setMesh(doc.createMesh('triangle').addPrimitive(doc.createPrimitive().setAttribute('POSITION', positions)));
            doc.getRoot().setDefaultScene(doc.createScene('review').addChild(node));
            const input = doc.createAccessor('time').setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0, duration]));
            const outputValues = interpolation === 'CUBICSPLINE'
              ? new Float32Array([0,0,0, 0,0,0, 0,0,0, 0,0,0, 0.1,0,0, 0,0,0])
              : new Float32Array([0,0,0, 0.1,0,0]);
            const output = doc.createAccessor('translation').setBuffer(buffer).setType('VEC3').setArray(outputValues);
            const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(interpolation);
            const animation = doc.createAnimation(name).addSampler(sampler);
            animation.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
            await new NodeIO().write(file, doc);
            """#
        let process = Process()
        let errors = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--input-type=module", "-e", source, path.path, name, String(duration), interpolation]
        process.currentDirectoryURL = repositoryDirectory()
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let errorText = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "ProductionWorkflowTests.NodeFixture", code: Int(process.terminationStatus),
                          userInfo: [NSLocalizedDescriptionKey: "Could not generate the GLB animation fixture: \(errorText)"])
        }
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
        let source = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/animated.glb", clips: [
            animationClip(2, name: "Walk", duration: 1.2)
        ]), requestedPath: "/tmp/animated.glb")
        let settings = try value.request(animationSources: [source])["request"]?["reviewSettings"]
        #expect(settings?["mode"] == .string("appearance"))
        #expect(settings?["pose"]?["clipIndex"] == .number(2))
        #expect(settings?["pose"]?["timeSeconds"] == .number(0.75))
        #expect(settings?["reviewLod"] == .string("LOD 1"))
        #expect(throws: (any Error).self) { try value.request() }
        value.reviewExposure = .nan
        #expect(throws: (any Error).self) { try value.request(animationSources: [source]) }
        value.reviewExposure = 1; value.clipTimeSeconds = -1
        #expect(throws: (any Error).self) { try value.request(animationSources: [source]) }
        value.clipTimeSeconds = 1.21
        #expect(throws: (any Error).self) { try value.request(animationSources: [source]) }
        value.clipTimeSeconds = 0; value.reviewResolution = 4096
        #expect(throws: (any Error).self) { try value.request(animationSources: [source]) }
    }

    @Test("Timeline intersects supported indexes and clamps time to the shortest actual clip")
    func animationTimelineBounds() throws {
        let first = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/first.glb", clips: [
            animationClip(0, name: "Walk", duration: 2.4), animationClip(1, name: "Unsupported", duration: 9, interpolation: ["FUTURE_MODE"])
        ]), requestedPath: "/tmp/first.glb")
        let second = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/second.glb", clips: [
            animationClip(0, name: "Walk", duration: 1.25, interpolation: ["CUBICSPLINE", "LINEAR"]), animationClip(1, name: "Unsupported", duration: 5)
        ]), requestedPath: "/tmp/second.glb")
        let timeline = try ProductionAnimationTimeline(sources: [second, first], matching: ["/tmp/first.glb", "/tmp/second.glb"])
        #expect(timeline.clips.map(\.index) == [0])
        #expect(timeline.clip(at: 0)?.minimumDurationSeconds == 1.25)
        #expect(timeline.contains(timeSeconds: 1.25, for: 0))
        #expect(!timeline.contains(timeSeconds: 1.251, for: 0))
        #expect(timeline.namesMatch(at: 0))
        #expect(second.clips.first(where: { $0.index == 0 })?.sampleable == true)
        #expect(first.clips.first(where: { $0.index == 1 })?.sampleable == false)

        var value = draft(.review)
        value.candidatePaths = "/tmp/first.glb\n/tmp/second.glb"
        value.sampleAnimation = true; value.clipIndex = 0; value.clipTimeSeconds = 1.25
        #expect(try value.request(animationSources: [first, second])["request"]?["reviewSettings"]?["pose"]?["timeSeconds"] == .number(1.25))
        value.clipTimeSeconds = 1.251
        #expect(throws: (any Error).self) { try value.request(animationSources: [first, second]) }
    }

    @Test("Different clip names require a source-bound acknowledgement")
    func animationNameMismatchAcknowledgement() throws {
        let first = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/first.glb", clips: [
            animationClip(0, name: "Idle", duration: 2)
        ], digest: String(repeating: "a", count: 64)), requestedPath: "/tmp/first.glb")
        let second = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/second.glb", clips: [
            animationClip(0, name: "Walk", duration: 1.5)
        ]), requestedPath: "/tmp/second.glb")
        let timeline = try ProductionAnimationTimeline(sources: [first, second], matching: ["/tmp/first.glb", "/tmp/second.glb"])
        let key = try #require(timeline.nameMappingConfirmationKey(at: 0))
        #expect(!timeline.namesMatch(at: 0))

        var value = draft(.review)
        value.candidatePaths = "/tmp/first.glb\n/tmp/second.glb"
        value.sampleAnimation = true; value.clipIndex = 0; value.clipTimeSeconds = 0
        #expect(throws: (any Error).self) { try value.request(animationSources: [first, second]) }
        value.confirmedAnimationClipMapping = key
        #expect(try value.request(animationSources: [first, second])["request"]?["reviewSettings"]?["pose"]?["clipIndex"] == .number(0))

        let changedSource = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/first.glb", clips: [
            animationClip(0, name: "Sit", duration: 2)
        ], digest: String(repeating: "b", count: 64)), requestedPath: "/tmp/first.glb")
        #expect(throws: (any Error).self) { try value.request(animationSources: [changedSource, second]) }

        var changedRendererInfo = animationInfo(path: "/tmp/first.glb", clips: [animationClip(0, name: "Idle", duration: 2)], digest: String(repeating: "a", count: 64))
        if case let .object(fields) = changedRendererInfo, case let .object(rendererFields)? = fields["renderer"] {
            var changedRendererFields = rendererFields
            changedRendererFields["version"] = .string("2.2.0")
            var changedFields = fields
            changedFields["renderer"] = .object(changedRendererFields)
            changedRendererInfo = .object(changedFields)
        }
        let changedRenderer = try ProductionAnimationSourceInfo(changedRendererInfo, requestedPath: "/tmp/first.glb")
        let changedTimeline = try ProductionAnimationTimeline(sources: [changedRenderer, second], matching: ["/tmp/first.glb", "/tmp/second.glb"])
        #expect(changedTimeline.nameMappingConfirmationKey(at: 0) != key)
        #expect(throws: (any Error).self) { try value.request(animationSources: [changedRenderer, second]) }
    }

    @Test("Animation metadata parser rejects malformed, duplicate or unbounded clip records")
    func malformedAnimationMetadata() throws {
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/other.glb", clips: []), requestedPath: "/tmp/model.glb")
        }
        let standardized = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/model.glb", clips: []), requestedPath: "/tmp/subdirectory/../model.glb")
        #expect(standardized.modelPath == "/tmp/model.glb")
        let duplicate = animationInfo(path: "/tmp/model.glb", clips: [
            animationClip(0, name: "A", duration: 1), animationClip(0, name: "B", duration: 2)
        ])
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(duplicate, requestedPath: "/tmp/model.glb")
        }
        let unbounded = animationInfo(path: "/tmp/model.glb", clips: [animationClip(0, name: "A", duration: 86_401)])
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(unbounded, requestedPath: "/tmp/model.glb")
        }
        let unsupportedPolicy = JSONValue.object([
            "schema": .string("game_dev.animation_review_info.v1"), "modelPath": .string("/tmp/model.glb"),
            "sourceSha256": .string(String(repeating: "c", count: 64)),
            "renderer": .object(["id": .string("gds-cpu-review"), "version": .string("2.1.0"), "lighting": .string("neutral-studio-v1")]),
            "clips": .array([]), "framing": .object(["policy": .string("sample-pose")])
        ])
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(unsupportedPolicy, requestedPath: "/tmp/model.glb")
        }
        var malformedRenderer = animationInfo(path: "/tmp/model.glb", clips: [])
        if case let .object(fields) = malformedRenderer {
            var changedFields = fields
            changedFields["renderer"] = .object(["id": .string("gds-cpu-review"), "version": .string("2.1.0")])
            malformedRenderer = .object(changedFields)
        }
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(malformedRenderer, requestedPath: "/tmp/model.glb")
        }
        var wrongRendererType = animationInfo(path: "/tmp/model.glb", clips: [])
        if case let .object(fields) = wrongRendererType {
            var changedFields = fields
            changedFields["renderer"] = .string("gds-cpu-review/2.1.0")
            wrongRendererType = .object(changedFields)
        }
        #expect(throws: (any Error).self) {
            try ProductionAnimationSourceInfo(wrongRendererType, requestedPath: "/tmp/model.glb")
        }
    }

    @Test("Unnamed and empty clip metadata has safe sampling behavior")
    func unnamedAndEmptyClips() throws {
        let source = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/model.glb", clips: [
            animationClip(0, name: "", duration: 0, channels: 0, interpolation: []),
            animationClip(1, name: "One key", duration: 0, channels: 1, interpolation: ["STEP"]),
            animationClip(2, name: "", duration: 1, channels: 1, interpolation: ["STEP"])
        ]), requestedPath: "/tmp/model.glb")
        let clip = try #require(source.clips.first { $0.index == 0 })
        #expect(clip.name.isEmpty)
        #expect(clip.displayName == "Unnamed clip 0")
        #expect(!clip.sampleable)

        let timeline = try ProductionAnimationTimeline(sources: [source], matching: ["/tmp/model.glb"])
        #expect(timeline.clips.map(\.index) == [1, 2])
        #expect(timeline.clip(at: 1)?.minimumDurationSeconds == 0)
        #expect(timeline.contains(timeSeconds: 0, for: 1))
        #expect(!timeline.contains(timeSeconds: 0.001, for: 1))
        #expect(timeline.namesMatch(at: 2))
        #expect(timeline.nameMappingConfirmationKey(at: 2) == nil)

        var values = draft(.review)
        values.candidatePaths = "/tmp/model.glb"
        values.sampleAnimation = true; values.clipIndex = 2; values.clipTimeSeconds = 0
        #expect(try values.request(animationSources: [source])["request"]?["reviewSettings"]?["pose"]?["timeSeconds"] == .number(0))

        let second = try ProductionAnimationSourceInfo(animationInfo(path: "/tmp/other.glb", clips: [
            animationClip(2, name: "", duration: 0.75, channels: 1, interpolation: ["STEP"])
        ]), requestedPath: "/tmp/other.glb")
        let sharedTimeline = try ProductionAnimationTimeline(
            sources: [source, second], matching: ["/tmp/model.glb", "/tmp/other.glb"]
        )
        #expect(!sharedTimeline.namesMatch(at: 2))
        let confirmation = try #require(sharedTimeline.nameMappingConfirmationKey(at: 2))

        values.candidatePaths = "/tmp/model.glb\n/tmp/other.glb"
        values.sampleAnimation = true; values.clipIndex = 2; values.clipTimeSeconds = 0
        #expect(throws: (any Error).self) { try values.request(animationSources: [source, second]) }
        values.confirmedAnimationClipMapping = confirmation
        #expect(try values.request(animationSources: [source, second])["request"]?["reviewSettings"]?["pose"]?["clipIndex"] == .number(2))
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
        let repository = repositoryDirectory()
        let entrypoint = builtRuntimeEntrypoint()
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

    @Test("Built runtime animation metadata populates the bounded native timeline")
    func builtRuntimeAnimationContract() async throws {
        let entrypoint = builtRuntimeEntrypoint()
        guard FileManager.default.fileExists(atPath: entrypoint.path) else {
            withKnownIssue("Build dist/cli.js before the actual-runtime animation contract check.") { Issue.record("CLI not built") }
            return
        }

        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent("anvil animation contract-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: workspace) }
        let idleURL = workspace.appendingPathComponent("idle-cubic.glb")
        let walkURL = workspace.appendingPathComponent("walk-linear.glb")
        try writeAnimatedGLBFixture(at: idleURL, name: "Idle", duration: 2.4, interpolation: "CUBICSPLINE")
        try writeAnimatedGLBFixture(at: walkURL, name: "Walk", duration: 1.25, interpolation: "LINEAR")

        let client = GameDevCLIClient(executableURL: URL(fileURLWithPath: "/usr/bin/env"))
        func inspect(_ path: URL) async throws -> JSONValue {
            let request = try RoadmapToolRequest(value: .object(["modelPath": .string(path.path)]))
            let result = try await client.execute(CLIInvocation(
                arguments: ["node", entrypoint.path, "tool", "call", "inspect_review_animation", "--request", "-",
                            "--output-dir", workspace.path, "--json"],
                standardInput: request.data, expectedOperation: "tool.inspect_review_animation"),
                credentials: [:], timeout: .seconds(30))
            #expect(result.envelope.ok)
            return result.envelope.data
        }

        let idleValue = try await inspect(idleURL)
        let walkValue = try await inspect(walkURL)
        var values = draft(.review)
        values.candidatePaths = "\(idleURL.path)\n\(walkURL.path)"
        let idle = try values.applyAnimationInfo(idleValue, requestedPath: idleURL.path)
        let walk = try values.applyAnimationInfo(walkValue, requestedPath: walkURL.path)

        #expect(idle.modelPath == idleURL.path)
        #expect(idle.sourceSHA256.count == 64)
        #expect(idle.renderer.id == "gds-cpu-review")
        #expect(idle.renderer.version == "2.1.0")
        #expect(idle.renderer.lighting == "neutral-studio-v1")
        #expect(idle.clips.first?.interpolations == ["CUBICSPLINE"])
        #expect(idle.clips.first?.supported == true)
        #expect(idle.clips.first?.sampleable == true)
        #expect(walk.clips.first?.interpolations == ["LINEAR"])

        let timeline = try ProductionAnimationTimeline(sources: [walk, idle], matching: [idleURL.path, walkURL.path])
        #expect(timeline.clips.map(\.index) == [0])
        #expect(timeline.sources.map(\.requestedPath) == [idleURL.path, walkURL.path])
        #expect(timeline.clip(at: 0)?.minimumDurationSeconds == 1.25)
        #expect(!timeline.namesMatch(at: 0))

        values.sampleAnimation = true
        values.clipIndex = 0
        values.clipTimeSeconds = 1.0
        #expect(throws: (any Error).self) { try values.request(animationSources: [idle, walk]) }
        values.confirmedAnimationClipMapping = try #require(timeline.nameMappingConfirmationKey(at: 0))
        let request = try values.request(animationSources: [idle, walk])
        #expect(request["request"]?["reviewSettings"]?["pose"]?["clipIndex"] == .number(0))
        #expect(request["request"]?["reviewSettings"]?["pose"]?["timeSeconds"] == .number(1.0))
        values.clipTimeSeconds = 1.251
        #expect(throws: (any Error).self) { try values.request(animationSources: [idle, walk]) }
    }
}
