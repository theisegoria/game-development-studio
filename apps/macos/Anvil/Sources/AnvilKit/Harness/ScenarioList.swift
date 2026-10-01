import Foundation

/// One scenario as the adapter manifest declares it.
public struct ScenarioSummary: Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let description: String?
    public let capabilities: [ScenarioCapability]
    public let outputFormat: String

    public init(
        id: String,
        title: String,
        description: String? = nil,
        capabilities: [ScenarioCapability],
        outputFormat: String = "none"
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.capabilities = capabilities
        self.outputFormat = outputFormat
    }

    /// True when a run would leave a capture to look at. `none` runs produce a sealed
    /// bundle of logs but nothing the Visual workspace can open.
    public var producesCapture: Bool { outputFormat != "none" }
}

/// The `scenario list` result: what a project's adapter can run.
public struct ScenarioList: Sendable, Hashable {
    public static let schema = "game_dev.scenario_list.v1"

    public let adapterID: String
    public let adapterVersion: String
    public let scenarios: [ScenarioSummary]

    public enum DecodingFailure: Error, LocalizedError, Equatable {
        case notAnObject
        case unexpectedSchema(String?)
        case missing(String)

        public var errorDescription: String? {
            switch self {
            case .notAnObject: "The scenario list is not an object."
            case let .unexpectedSchema(found):
                "Expected a \(ScenarioList.schema) result but received \(found ?? "no schema")."
            case let .missing(field): "The scenario list is missing \(field)."
            }
        }
    }

    public init(payload: JSONValue) throws {
        guard case let .object(fields) = payload else { throw DecodingFailure.notAnObject }
        guard fields["schema"]?.stringValue == Self.schema else {
            throw DecodingFailure.unexpectedSchema(fields["schema"]?.stringValue)
        }
        guard let adapterID = fields["adapterId"]?.stringValue else {
            throw DecodingFailure.missing("adapterId")
        }
        var scenarios: [ScenarioSummary] = []
        if case let .array(raw)? = fields["scenarios"] {
            for entry in raw {
                guard case let .object(s) = entry,
                      let id = s["id"]?.stringValue
                else { throw DecodingFailure.missing("scenarios[].id") }
                var capabilities: [ScenarioCapability] = []
                if case let .array(caps)? = s["capabilities"] {
                    // A capability this build does not know is dropped from the chip row
                    // but never from the plan: authorities come from the plan, so an
                    // unknown lane here cannot hide a required grant.
                    capabilities = caps.compactMap(\.stringValue).compactMap(ScenarioCapability.init(rawValue:))
                }
                scenarios.append(ScenarioSummary(
                    id: id,
                    title: s["title"]?.stringValue ?? id,
                    description: s["description"]?.stringValue,
                    capabilities: capabilities,
                    outputFormat: s["outputFormat"]?.stringValue ?? "none"
                ))
            }
        }
        self.adapterID = adapterID
        self.adapterVersion = fields["adapterVersion"]?.stringValue ?? ""
        self.scenarios = scenarios
    }
}
