import Foundation

extension JSONValue {
    var arrayValue: [JSONValue] { if case let .array(value) = self { value } else { [] } }
    var objectValue: [String: JSONValue] { if case let .object(value) = self { value } else { [:] } }
    var numberValue: Double? { if case let .number(value) = self { value } else { nil } }
    var boolValue: Bool? { if case let .bool(value) = self { value } else { nil } }
    func decoded<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
struct RunLibrary: Decodable { let runs: [RunEntry] }
struct RunEntry: Decodable, Identifiable {
    let id: String; let path: String; let verified: Bool
    let scenario: String?; let completedAt: String?; let outcome: String?; let evidence: String?; let error: String?
}
struct ScenarioList: Decodable { let scenarios: [ScenarioEntry] }
struct ScenarioEntry: Decodable, Identifiable {
    let id: String; let title: String; let capabilities: [String]; let parameters: [String: ScenarioParameter]
}
struct ScenarioParameter: Decodable {
    let type: String; let description: String?; let required: Bool?; let values: [String]?; let `default`: JSONValue?
    let minimum: Double?; let maximum: Double?
}
struct CaptureAnalysisModel: Decodable { let runId: String; let rasters: [CaptureRaster]; let unsupportedAttachments: [String]; let evidenceCeiling: String }
struct CaptureRaster: Decodable, Identifiable {
    let frameIndex: Int; let frameLabel: String?; let kind: String; let label: String?; let path: String
    let width: Int; let height: Int; let meanLuminance: Double; let alphaCoverage: Double; let uniqueSemanticIds: Int?
    var id: String { "\(frameIndex):\(kind):\(label ?? "")" }
}
struct VisualComparisonModel: Decodable {
    let baselineRunId: String; let candidateRunId: String; let pairs: [VisualPair]
    let unsupportedAttachments: [String]; let unmatchedBaseline: [String]; let unmatchedCandidate: [String]; let evidenceCeiling: String; let outputPath: String?
}
struct VisualPair: Decodable, Identifiable {
    let identity: String; let kind: String; let comparable: Bool; let baselinePath: String; let candidatePath: String
    let heatmapPath: String?; let meanAbsoluteError: Double?; let changedPixelRatio: Double?; let reason: String?
    let semanticRegions: [SemanticRegion]?
    var id: String { identity }
}
struct SemanticRegion: Decodable, Identifiable {
    let objectId: String; let pixels: Int; let meanAbsoluteError: Double; let changedPixelRatio: Double
    var id: String { objectId }
}
struct PerformanceModel: Decodable {
    let runId: String; let metrics: [MetricModel]; let measurements: [MeasurementModel]; let aggregates: [MeasurementModel]; let ambiguousMetrics: [String]
    let evidenceCeiling: String
}
struct MetricModel: Decodable, Identifiable {
    let metric: String; let unit: String; let samples: Int
    let min: Double; let max: Double; let mean: Double; let median: Double; let p95: Double; let p99: Double; let standardDeviation: Double
    var id: String { "\(metric):\(unit)" }
}
struct MeasurementModel: Decodable {
    let metric: String; let unit: String; let value: Double; let source: String; let aggregation: String
    let frameIndex: Int?; let timestampNs: String?
}
struct PerformanceComparisonModel: Decodable {
    let metrics: [MetricDelta]; let missingBaseline: [String]; let missingCandidate: [String]; let incompatibleGroups: [String]
    let comparability: ComparabilityModel; let evidenceCeiling: String
}
struct MetricDelta: Decodable, Identifiable {
    let metric: String; let unit: String; let baseline: Double; let candidate: Double; let delta: Double; let percentDelta: Double?
    var id: String { "\(metric):\(unit)" }
}
struct ComparabilityModel: Decodable { let status: String; let differences: [String]; let unknown: [String] }
struct OptimizationSessionModel: Decodable {
    let plan: OptimizationPlanModel
    let id: String; let directory: String; let checkout: String; let status: String; let attempts: [OptimizationAttemptModel]; let bestAttempt: Int?
}
struct OptimizationAttemptModel: Decodable, Identifiable {
    let number: Int; let status: String; let value: Double?; let targetMet: Bool?; let error: String?; let runPath: String?
    var id: Int { number }
}

struct OptimizationPlanModel: Decodable { let request: OptimizationTargetModel }
struct OptimizationTargetModel: Decodable { let target: Double; let metric: String; let unit: String; let direction: String }
