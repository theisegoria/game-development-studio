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
    public var reviewLod = ""
    public var sampleAnimation = false
    public var clipIndex = 0
    public var clipTimeSeconds = 0.0

    public init() {}

    public func request() throws -> JSONValue {
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
            let paths = candidatePaths.split(whereSeparator: \.isNewline).map { String($0).trimmingCharacters(in: .whitespaces) }
            guard (1...6).contains(paths.count), Set(paths).count == paths.count,
                  paths.allSatisfy({ Self.absolute($0) && URL(fileURLWithPath: $0).pathExtension.lowercased() == "glb" }) else {
                throw invalid("Enter 1–6 different absolute model paths, one per line.")
            }
            request["candidates"] = .array(paths.enumerated().map { index, path in
                .object(["name": .string("Candidate \(index + 1)"), "modelPath": .string(path)])
            })
            guard ["geometry", "appearance"].contains(reviewMode), [128, 256].contains(reviewResolution),
                  reviewExposure.isFinite, (0.25...4).contains(reviewExposure), reviewLod.count <= 200,
                  !sampleAnimation || clipIndex >= 0 && clipTimeSeconds.isFinite && (0...86400).contains(clipTimeSeconds) else {
                throw invalid("Review settings require a supported mode/resolution, exposure 0.25–4 and a valid animation sample time.")
            }
            var settings: [String: JSONValue] = ["mode": .string(reviewMode), "resolution": .number(Double(reviewResolution)), "exposure": .number(reviewExposure)]
            if !reviewLod.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { settings["reviewLod"] = .string(reviewLod) }
            if sampleAnimation { settings["pose"] = .object(["clipIndex": .number(Double(clipIndex)), "timeSeconds": .number(clipTimeSeconds)]) }
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
    private static func absolute(_ value: String) -> Bool { value.hasPrefix("/") && !value.contains("\0") }
    private func invalid(_ message: String) -> GameDevCLIClientError { .invalidInvocation(message) }
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

public extension JSONValue {
    var formattedJSON: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "null"
    }
}
