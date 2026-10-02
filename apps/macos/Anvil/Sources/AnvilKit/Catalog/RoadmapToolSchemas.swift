import Foundation

/// Exported from the shipped runtime's MCP tools/list, never handwritten field types.
public enum RoadmapToolSchemas {
    public static let all: [String: JSONValue] = {
        if Bundle.main.bundleURL.pathExtension == "app" {
            // Installed apps must use their own staged resources. Never fall back to
            // a developer's build tree, and never invoke Bundle.module's fatalError.
            return Bundle.main.resourceURL.map(load(appResources:)) ?? [:]
        }
        return load(bundle: Bundle.module)
    }()

    static func load(appResources: URL) -> [String: JSONValue] {
        guard let bundle = Bundle(url: appResources.appendingPathComponent("Anvil_AnvilKit.bundle")) else { return [:] }
        return load(bundle: bundle)
    }

    private static func load(bundle: Bundle) -> [String: JSONValue] {
        guard let url = bundle.url(forResource: "roadmap-tool-schemas", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let schemas = try? JSONDecoder().decode([String: JSONValue].self, from: data) else { return [:] }
        return schemas
    }

    public static func formatted(_ name: String) -> String {
        guard let schema = all[name] else { return "Schema unavailable; operation disabled." }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(schema)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    public static var commands: [CommandSpec] {
        CommandCatalog.all.filter { $0.registryTool.map { all[$0] != nil } ?? false }
    }
}

/// Immutable request shown to the person before a single invocation. No saved run grants are read.
public struct RoadmapToolRequest: Sendable {
    public let data: Data
    public func selectedStep(in plan: JSONValue) throws -> JSONValue {
        let request = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let recipeID = request["recipeId"]?.stringValue, plan["id"]?.stringValue == recipeID,
              let stepID = request["stepId"]?.stringValue,
              let fingerprint = request["approvedFingerprint"]?.stringValue,
              case let .array(steps)? = plan["steps"],
              let step = steps.first(where: { $0["id"]?.stringValue == stepID }),
              step["status"]?.stringValue == "ready", step["fingerprint"]?.stringValue == fingerprint,
              case let .bool(paid)? = step["paid"],
              let operation = step["operation"]?.stringValue,
              let command = CommandCatalog.byRegistryTool[operation], command.spend.isPaid == paid else {
            throw GameDevCLIClientError.invalidInvocation("The selected step is stale, unavailable or lacks trustworthy spend metadata. Plan again.")
        }
        return step
    }

    public init(json: String) throws {
        data = Data(json.utf8)
        guard data.count <= 1_048_576,
              case .object = try JSONDecoder().decode(JSONValue.self, from: data) else {
            throw GameDevCLIClientError.invalidInvocation("Enter a JSON object no larger than 1 MiB.")
        }
    }
}
