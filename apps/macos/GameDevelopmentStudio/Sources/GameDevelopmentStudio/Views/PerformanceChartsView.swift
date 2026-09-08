import SwiftUI
import Charts

struct PerformanceChartsView: View {
    let summary: PerformanceModel
    @State private var selected = ""
    private var metric: MetricModel? { summary.metrics.first(where: { $0.id == selected }) ?? summary.metrics.first }
    private var samples: [MeasurementModel] { summary.measurements.filter { $0.metric == metric?.metric && $0.unit == metric?.unit && $0.aggregation == "sample" } }
    var body: some View {
        MaterialCard(title: "Measurements", systemImage: "chart.xyaxis.line") {
            Picker("Metric", selection: $selected) { ForEach(summary.metrics) { Text("\($0.metric) [\($0.unit)]").tag($0.id) } }
            if let metric {
                Grid(alignment: .leading) {
                    GridRow { Text("Samples"); Text("Min"); Text("Median"); Text("Mean"); Text("P95"); Text("P99"); Text("Max") }.font(.caption.bold())
                    GridRow {
                        Text(String(metric.samples))
                        Text(metric.min, format: .number)
                        Text(metric.median, format: .number)
                        Text(metric.mean, format: .number)
                        Text(metric.p95, format: .number)
                        Text(metric.p99, format: .number)
                        Text(metric.max, format: .number)
                    }.font(.caption.monospacedDigit())
                }
                Chart(Array(samples.prefix(2000).enumerated()), id: \.offset) { item in
                    LineMark(x: .value("Sample", item.offset), y: .value(metric.unit, item.element.value))
                        .foregroundStyle(by: .value("Source", item.element.source))
                }.frame(height: 200).accessibilityLabel("Raw sample sequence for \(metric.metric)")
                Chart(bins, id: \.index) { bin in
                    BarMark(x: .value(metric.unit, bin.center), y: .value("Samples", bin.count))
                }.chartXScale(domain: (metric.min - max((metric.max - metric.min) / 16, 0.001))...(metric.max + max((metric.max - metric.min) / 16, 0.001)))
                    .frame(height: 160).accessibilityLabel("Measurement distribution")
                if samples.count > 2000 { Text("Sequence shows the first 2,000 samples; statistics and histogram use all samples.").font(.caption) }
            } else { Text("No raw samples. Supplied aggregates are listed separately.") }
            if !summary.ambiguousMetrics.isEmpty { Text("Separate source groups: \(summary.ambiguousMetrics.joined(separator: ", ")). No pooled distribution is computed.").font(.caption) }
            ForEach(Array(summary.aggregates.enumerated()), id: \.offset) { item in
                Text("Supplied \(item.element.aggregation.uppercased()) · \(item.element.metric): \(item.element.value, format: .number) \(item.element.unit) (\(item.element.source))").font(.caption)
            }
            EvidenceNote(text: summary.evidenceCeiling)
        }
        .task(id: summary.runId) { selected = summary.metrics.first?.id ?? "" }
    }
    private struct Bin { let index: Int; let center: Double; let count: Int }
    private var bins: [Bin] {
        guard let metric else { return [] }
        let width = max((metric.max - metric.min) / 16, 0.000001)
        var counts = Array(repeating: 0, count: 16)
        for sample in samples { counts[min(15, max(0, Int((sample.value - metric.min) / width)))] += 1 }
        return counts.enumerated().map { Bin(index: $0.offset, center: metric.min + (Double($0.offset) + 0.5) * width, count: $0.element) }
    }
}
struct PerformanceDeltaView: View {
    let comparison: PerformanceComparisonModel
    var body: some View {
        MaterialCard(title: "Baseline and candidate", systemImage: "chart.bar.xaxis") {
            Label("Comparability: \(comparison.comparability.status)", systemImage: comparison.comparability.status == "compatible" ? "checkmark.circle" : "info.circle")
            Text("Different: \(comparison.comparability.differences.joined(separator: ", ")) · Unknown: \(comparison.comparability.unknown.joined(separator: ", "))").font(.caption)
            ForEach(comparison.metrics) { metric in
                HStack {
                    Text(metric.metric).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(metric.baseline, format: .number) → \(metric.candidate, format: .number) \(metric.unit)")
                    Text("Δ \(metric.delta, format: .number)").monospacedDigit()
                }.font(.callout)
            }
            ForEach([("Missing baseline", comparison.missingBaseline), ("Missing candidate", comparison.missingCandidate), ("Incompatible sources", comparison.incompatibleGroups)], id: \.0) { label, values in
                if !values.isEmpty { Text("\(label): \(values.joined(separator: ", "))").foregroundStyle(.orange) }
            }
            EvidenceNote(text: comparison.evidenceCeiling)
        }
    }
}
