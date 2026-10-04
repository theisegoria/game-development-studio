import Foundation

/// Form values contain no authority. The runtime expands these into its canonical recipe.
public struct ProductionWorkflowDraft: Equatable, Sendable {
    public enum Template: String, CaseIterable, Sendable, Identifiable {
        case inspect = "inspect-validate-package"
        case review = "review-select-package"
        case platform = "platform-variants"
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .inspect: "Inspect, validate and package"
            case .review: "Review, select and package"
            case .platform: "Prepare platform variants"
            }
        }
    }
    public var template: Template = .inspect
    public var recipeID = ""
    public var name = ""
    public var license = ""
    public var modelPath = ""
    public var candidatePaths = ""
    public var variantID = "desktop"
    public var lodTriangles = "20000, 10000"
    public var maxMaterials = 8
    public var maxTextureSize = 2048
    public var textureMode = "preserve"
    public var materialMode = "preserve"
    public var collision = "none"
    public var reviewMode = "geometry"
    public var reviewResolution = 256
    public var reviewExposure = 1.0
    public var decodeBasisTextures = false
    public var reviewLod = ""
    public var sharedFramingEnabled = false
    public var framingCenterX = 0.0
    public var framingCenterY = 0.0
    public var framingCenterZ = 0.0
    public var framingExtent = 1.0
    public var sampleAnimation = false
    public var sampleAnimationPlayback = false
    public var clipEndSeconds = 1.0
    public var playbackFrameCount = 8
    public var clipIndex = -1
    public var clipTimeSeconds = 0.0
    public var confirmedAnimationClipMapping: String?

    public init() {}

    public func candidateModelPaths() throws -> [String] {
        let paths = candidatePaths.split(whereSeparator: \.isNewline).map { String($0).trimmingCharacters(in: .whitespaces) }
        guard (1...6).contains(paths.count), Set(paths).count == paths.count,
              paths.allSatisfy({ Self.absolute($0) && URL(fileURLWithPath: $0).pathExtension.lowercased() == "glb" }) else {
            throw invalid("Enter 1–6 different absolute model paths, one per line.")
        }
        return paths
    }

    /// Associates one runtime inspection result with a candidate in this draft.
    /// The response itself remains authoritative for clip names, duration and source identity.
    public func applyAnimationInfo(_ value: JSONValue, requestedPath: String) throws -> ProductionAnimationSourceInfo {
        guard template == .review, try candidateModelPaths().contains(requestedPath) else {
            throw invalid("Animation metadata must belong to a current review candidate.")
        }
        return try ProductionAnimationSourceInfo(value, requestedPath: requestedPath)
    }

    public func request(animationSources: [ProductionAnimationSourceInfo] = []) throws -> JSONValue {
        let identifierLimit = 60
        guard Self.identifier(recipeID, maximum: identifierLimit) else {
            throw invalid("Recipe ID must contain 1–\(identifierLimit) letters, numbers, underscores or hyphens.")
        }
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 100,
              !license.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, license.count <= 200 else {
            throw invalid("Enter a name and the asset's actual license.")
        }
        var request: [String: JSONValue] = ["recipeId": .string(recipeID), "name": .string(name), "license": .string(license)]
        if template == .review {
            let paths = try candidateModelPaths()
            request["candidates"] = .array(paths.enumerated().map { index, path in
                .object(["name": .string("Candidate \(index + 1)"), "modelPath": .string(path)])
            })
            guard ["geometry", "appearance"].contains(reviewMode), [128, 256].contains(reviewResolution),
                  reviewExposure.isFinite, (0.25...4).contains(reviewExposure), reviewLod.count <= 200 else {
                throw invalid("Review settings require a supported mode/resolution, exposure 0.25–4 and a valid review LOD label.")
            }
            var settings: [String: JSONValue] = ["mode": .string(reviewMode), "resolution": .number(Double(reviewResolution)), "exposure": .number(reviewExposure)]
            if reviewMode == "appearance" {
                settings["decodeBasisTextures"] = .bool(decodeBasisTextures)
            }
            if sharedFramingEnabled {
                let center = [framingCenterX, framingCenterY, framingCenterZ]
                guard center.allSatisfy({ $0.isFinite && (-1e12...1e12).contains($0) }),
                      framingExtent.isFinite, (0.00001...2e12).contains(framingExtent) else {
                    throw invalid("Shared framing centers must be finite and within ±1e12; extent must be finite and between 0.00001 and 2e12.")
                }
                settings["framing"] = .object([
                    "center": .array(center.map(JSONValue.number)),
                    "extent": .number(framingExtent),
                ])
            }
            if !reviewLod.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { settings["reviewLod"] = .string(reviewLod) }
            if sampleAnimation {
                let timeline = try ProductionAnimationTimeline(sources: animationSources, matching: paths)
                guard timeline.clip(at: clipIndex) != nil else {
                    throw invalid("Inspect every candidate and choose a clip index supported by all of them.")
                }
                guard timeline.namesMatch(at: clipIndex)
                        || timeline.nameMappingConfirmationKey(at: clipIndex) == confirmedAnimationClipMapping else {
                    throw invalid("The selected clip index has different names across candidates. Confirm that sampling the same index across them is intended.")
                }
                guard clipTimeSeconds.isFinite, timeline.contains(timeSeconds: clipTimeSeconds, for: clipIndex) else {
                    throw invalid("The sample time must be between zero and the selected clip's shortest inspected duration.")
                }
                if sampleAnimationPlayback {
                    guard reviewMode == "appearance", reviewResolution == 128, !decodeBasisTextures,
                          (2...16).contains(playbackFrameCount), clipEndSeconds.isFinite,
                          clipEndSeconds > clipTimeSeconds, timeline.contains(timeSeconds: clipEndSeconds, for: clipIndex) else {
                        throw invalid("Sampled playback requires appearance at 128 pixels, 2–16 frames, an increasing time range within every selected clip, and PNG/JPEG textures without Basis decoding.")
                    }
                    settings["timeline"] = .object(["clipIndex": .number(Double(clipIndex)), "startSeconds": .number(clipTimeSeconds),
                                                    "endSeconds": .number(clipEndSeconds), "frameCount": .number(Double(playbackFrameCount))])
                } else {
                    settings["pose"] = .object(["clipIndex": .number(Double(clipIndex)), "timeSeconds": .number(clipTimeSeconds)])
                }
            }
            request["reviewSettings"] = .object(settings)
        } else {
            let extensions = template == .platform ? ["glb", "gltf"] : ["glb"]
            guard Self.absolute(modelPath), extensions.contains(URL(fileURLWithPath: modelPath).pathExtension.lowercased()) else {
                throw invalid(template == .platform ? "Enter an absolute GLB or glTF model path." : "This workflow packages a self-contained GLB. Enter an absolute GLB path.")
            }
            request["modelPath"] = .string(modelPath)
        }
        if template == .platform {
            let tokens = lodTriangles.split(separator: ",", omittingEmptySubsequences: false)
            let triangles = tokens.compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            guard Self.identifier(variantID, maximum: 32), (1...8).contains(triangles.count), triangles.count == tokens.count,
                  triangles.allSatisfy({ (1...10_000_000).contains($0) }),
                  (1...4096).contains(maxMaterials), (1...16384).contains(maxTextureSize),
                  ["preserve", "resize", "compress"].contains(textureMode),
                  ["preserve", "opaque"].contains(materialMode), ["none", "box", "convex"].contains(collision) else {
                throw invalid("Enter a valid variant ID, 1–8 positive LOD triangle budgets and material/texture budgets.")
            }
            request["variants"] = .array([.object([
                "id": .string(variantID), "lodTriangles": .array(triangles.map { .number(Double($0)) }),
                "maxMaterials": .number(Double(maxMaterials)), "maxTextureSize": .number(Double(maxTextureSize)),
                "textureMode": .string(textureMode), "materialMode": .string(materialMode), "collision": .string(collision)
            ])])
        }
        return .object(["templateId": .string(template.rawValue), "request": .object(request)])
    }

    public static func identifier(_ value: String, maximum: Int = 80) -> Bool {
        !value.isEmpty && value.count <= maximum && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45
        }
    }
    private static func absolute(_ value: String) -> Bool { value.hasPrefix("/") && value.utf8.count <= 4096 && !value.contains("\0") }
    private func invalid(_ message: String) -> GameDevCLIClientError { .invalidInvocation(message) }
}

/// One animation record returned by the CPU-only review metadata inspector.
public struct ProductionAnimationClip: Identifiable, Equatable, Sendable {
    public let index: Int
    public let name: String
    public let durationSeconds: Double
    public let channels: Int
    public let interpolations: [String]
    public let supported: Bool

    public var id: Int { index }
    public var displayName: String {
        name.isEmpty ? "Unnamed clip \(index)" : name
    }
    public var sampleable: Bool {
        supported && channels > 0 && !interpolations.isEmpty
            && interpolations.allSatisfy { ["LINEAR", "STEP", "CUBICSPLINE"].contains($0) }
    }

    fileprivate init(_ value: JSONValue) throws {
        guard let index = value["index"]?.finiteInteger, (0..<128).contains(index),
              let name = value["name"]?.stringValue, name.count <= 200,
              let duration = value["durationSeconds"]?.finiteNumber, duration.isFinite, (0...86_400).contains(duration),
              let channels = value["channels"]?.finiteInteger, (0...1_000_000).contains(channels),
              case let .array(rawInterpolations)? = value["interpolation"], (0...3).contains(rawInterpolations.count),
              case let .bool(supported)? = value["supported"] else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned malformed or unbounded animation clip metadata.")
        }
        let interpolations = rawInterpolations.compactMap(\.stringValue).map { $0.uppercased() }
        guard interpolations.count == rawInterpolations.count,
              interpolations.allSatisfy({ !$0.isEmpty && $0.count <= 32 }), Set(interpolations).count == interpolations.count else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned malformed animation interpolation metadata.")
        }
        self.index = index
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.durationSeconds = duration
        self.channels = channels
        self.interpolations = interpolations.sorted()
        self.supported = supported
    }
}

public struct ProductionAnimationRenderer: Equatable, Sendable {
    public let id: String
    public let version: String
    public let lighting: String

    fileprivate init(_ value: JSONValue) throws {
        guard let id = value["id"]?.stringValue, !id.isEmpty, id.count <= 100,
              let version = value["version"]?.stringValue, !version.isEmpty, version.count <= 64,
              let lighting = value["lighting"]?.stringValue, !lighting.isEmpty, lighting.count <= 100 else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned unsupported or unbounded animation renderer metadata.")
        }
        self.id = id
        self.version = version
        self.lighting = lighting
    }
}

/// Verified metadata tied to the exact source bytes inspected by the runtime.
public struct ProductionAnimationSourceInfo: Equatable, Sendable, Identifiable {
    public let requestedPath: String
    public let modelPath: String
    public let sourceSHA256: String
    public let renderer: ProductionAnimationRenderer
    public let clips: [ProductionAnimationClip]
    public let framingPolicy: String
    public let warnings: [String]

    public var id: String { requestedPath }

    public init(_ value: JSONValue, requestedPath: String) throws {
        guard value["schema"]?.stringValue == "game_dev.animation_review_info.v1",
              let modelPath = value["modelPath"]?.stringValue, Self.isAbsoluteGLB(modelPath),
              Self.isAbsoluteGLB(requestedPath),
              URL(fileURLWithPath: modelPath).standardizedFileURL.path == URL(fileURLWithPath: requestedPath).standardizedFileURL.path,
              let digest = value["sourceSha256"]?.stringValue, Self.isSHA256(digest),
              case let .object(rendererValue)? = value["renderer"],
              case let .array(rawClips)? = value["clips"], rawClips.count <= 128,
              value["framing"]?["policy"]?.stringValue == "default-pose",
              case let .array(rawWarnings)? = value["warnings"], rawWarnings.count <= 64 else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned unsupported or incomplete animation review metadata.")
        }
        let renderer = try ProductionAnimationRenderer(.object(rendererValue))
        let clips = try rawClips.map(ProductionAnimationClip.init)
        guard Set(clips.map(\.index)).count == clips.count else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned repeated animation clip indexes.")
        }
        let warnings = Array(Set(rawWarnings.compactMap(\.stringValue).filter { $0.count <= 500 })).sorted()
        self.requestedPath = requestedPath
        self.modelPath = modelPath
        self.sourceSHA256 = digest
        self.renderer = renderer
        self.clips = clips.sorted { $0.index < $1.index }
        self.framingPolicy = "default-pose"
        self.warnings = warnings
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func isAbsoluteGLB(_ value: String) -> Bool {
        value.hasPrefix("/") && value.utf8.count <= 4096 && !value.contains("\0")
            && URL(fileURLWithPath: value).pathExtension.lowercased() == "glb"
    }
}

/// Common clip indexes for a candidate set. The usable time range ends at the
/// shortest real duration, so one settings value remains valid for every input.
public struct ProductionAnimationTimeline: Equatable, Sendable {
    public struct Clip: Identifiable, Equatable, Sendable {
        public let index: Int
        public let candidateNames: [String]
        public let minimumDurationSeconds: Double
        public let channels: [Int]
        public let interpolations: [[String]]

        public var id: Int { index }
        public var namesMatch: Bool {
            guard candidateNames.count > 1 else { return true }
            return candidateNames.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                && Set(candidateNames.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).count == 1
        }
    }

    public let sources: [ProductionAnimationSourceInfo]
    public let clips: [Clip]

    public init(sources: [ProductionAnimationSourceInfo], matching paths: [String]) throws {
        guard (1...6).contains(paths.count), sources.count == paths.count,
              Set(sources.map(\.requestedPath)).count == sources.count,
              Set(paths) == Set(sources.map(\.requestedPath)) else {
            throw GameDevCLIClientError.invalidInvocation("Animation metadata must match every current review candidate exactly once.")
        }
        let ordered = paths.compactMap { path in sources.first { $0.requestedPath == path } }
        var commonIndexes: Set<Int>?
        for source in ordered {
            let supported = Set(source.clips.filter(\.sampleable).map(\.index))
            commonIndexes = commonIndexes.map { $0.intersection(supported) } ?? supported
        }
        let indexes = (commonIndexes ?? []).sorted()
        self.sources = ordered
        self.clips = indexes.compactMap { index in
            let matching = ordered.compactMap { source in source.clips.first { $0.index == index } }
            guard matching.count == ordered.count else { return nil }
            return Clip(index: index, candidateNames: matching.map(\.name),
                        minimumDurationSeconds: matching.map(\.durationSeconds).min() ?? 0,
                        channels: matching.map(\.channels), interpolations: matching.map(\.interpolations))
        }
    }

    public func clip(at index: Int) -> Clip? { clips.first { $0.index == index } }
    public func namesMatch(at index: Int) -> Bool { clip(at: index)?.namesMatch == true }
    public func contains(timeSeconds: Double, for index: Int) -> Bool {
        guard let clip = clip(at: index) else { return false }
        return timeSeconds >= 0 && timeSeconds <= clip.minimumDurationSeconds
    }

    /// Binds the user's acknowledgement to this clip mapping and the inspected source hashes.
    public func nameMappingConfirmationKey(at index: Int) -> String? {
        guard let clip = clip(at: index), !clip.namesMatch else { return nil }
        let mappings = zip(sources, clip.candidateNames).map { source, name in
            JSONValue.object([
                "modelPath": .string(source.requestedPath), "sourceSha256": .string(source.sourceSHA256),
                "renderer": .object(["id": .string(source.renderer.id), "version": .string(source.renderer.version), "lighting": .string(source.renderer.lighting)]),
                "clipName": .string(name)
            ])
        }
        return JSONValue.object(["clipIndex": .number(Double(index)), "mappings": .array(mappings)]).formattedJSON
    }
}

public struct ProductionPlan: Sendable {
    public let recipeID: String
    public let steps: [ProductionStep]
    public let raw: JSONValue
    public init(_ value: JSONValue) throws {
        guard value["schema"]?.stringValue == "game_dev.recipe_plan.v1",
              let id = value["id"]?.stringValue, ProductionWorkflowDraft.identifier(id),
              case let .array(steps)? = value["steps"], (1...128).contains(steps.count) else {
            throw GameDevCLIClientError.invalidInvocation("The runtime returned an unsupported recipe plan.")
        }
        recipeID = id; raw = value
        self.steps = try steps.map(ProductionStep.init)
        guard Set(self.steps.map(\.id)).count == self.steps.count else {
            throw GameDevCLIClientError.invalidInvocation("The recipe plan contains repeated step IDs.")
        }
    }
}

public struct ProductionStep: Identifiable, Sendable {
    public enum State: String, Sendable { case completed, ready, blocked, invalidated, uncertain }
    public let id: String
    public let operation: String
    public let state: State
    public let fingerprint: String?
    public let reasons: [String]
    public let arguments: JSONValue?
    public let evidence: JSONValue?
    public let paid: Bool?
    public let raw: JSONValue

    public init(_ value: JSONValue) throws {
        guard let id = value["id"]?.stringValue, let operation = value["operation"]?.stringValue else {
            throw GameDevCLIClientError.invalidInvocation("A recipe step has no identity or operation.")
        }
        self.id = id; self.operation = operation; raw = value
        let status = value["status"]?.stringValue
        if let reported = value["state"]?.stringValue { self.state = State(rawValue: reported) ?? .uncertain }
        else if status == "complete" { state = .completed }
        else if status == "invalid" || value["previousState"]?.stringValue == "complete" && status == "ready" { state = .invalidated }
        else { state = State(rawValue: status ?? "") ?? .uncertain }
        fingerprint = value["fingerprint"]?.stringValue
        arguments = value["arguments"]; evidence = value["evidence"]
        if case let .bool(paid)? = value["paid"] { self.paid = paid } else { paid = nil }
        if case let .array(reasons)? = value["reasons"] { self.reasons = reasons.compactMap(\.stringValue) }
        else if let issue = value["issue"]?.stringValue { reasons = [issue] }
        else {
            let reason = switch state {
            case .completed: "The current inputs and recorded outputs are verified."
            case .ready: "Dependencies are complete. Review the current request before running."
            case .blocked: "A dependency or required review is incomplete."
            case .invalidated: "Inputs, settings or outputs changed. Create a fresh plan and review."
            case .uncertain: "Inspect the recorded operation before recovery. No automatic retry is allowed."
            }
            reasons = [reason]
        }
    }

    /// Uses the runtime's fingerprint and spend classification. Unknown metadata fails closed.
    public func executionRequest(recipeID: String) throws -> RoadmapToolRequest {
        guard state == .ready || state == .invalidated, raw["status"]?.stringValue == "ready",
              let fingerprint, fingerprint.count == 64, fingerprint.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let paid, let spec = CommandCatalog.byRegistryTool[operation], spec.spend.isPaid == paid else {
            throw GameDevCLIClientError.invalidInvocation("This step is unavailable or has incomplete approval metadata. Refresh the plan.")
        }
        return try RoadmapToolRequest(value: .object([
            "recipeId": .string(recipeID), "stepId": .string(id), "approvedFingerprint": .string(fingerprint)
        ]))
    }
}

public extension RoadmapToolRequest {
    init(value: JSONValue) throws { try self.init(json: value.formattedJSON) }
}

private extension JSONValue {
    var finiteNumber: Double? {
        guard case let .number(value) = self, value.isFinite else { return nil }
        return value
    }

    var finiteInteger: Int? {
        guard let value = finiteNumber, value.rounded() == value,
              value >= Double(Int.min), value < Double(Int.max) else { return nil }
        return Int(value)
    }
}

public extension JSONValue {
    var formattedJSON: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "null"
    }
}
