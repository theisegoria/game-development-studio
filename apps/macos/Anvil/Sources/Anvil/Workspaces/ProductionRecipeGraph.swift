import AnvilKit
import SwiftUI

struct ProductionRecipeGraph: View {
    let plan: ProductionPlan
    let busy: Bool
    let onReview: (ProductionStep) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Workflow: \(plan.recipeID)").font(.headline)
            ForEach(plan.steps) { step in
                ProductionStepRow(step: step, busy: busy, onReview: { onReview(step) })
            }
        }
    }
}

struct ProductionTemplatePreview: View {
    let value: JSONValue
    private var steps: [JSONValue] {
        if case let .array(steps)? = value["recipe"]?["steps"] { steps } else { [] }
    }
    var body: some View {
        GroupBox("Preview workflow") {
            VStack(alignment: .leading, spacing: 8) {
                Text(value["template"]?["description"]?.stringValue ?? "Review the canonical recipe before saving.")
                ForEach(steps.compactMap { $0["id"]?.stringValue }, id: \.self) { id in
                    if let step = steps.first(where: { $0["id"]?.stringValue == id }) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(id).font(.callout.bold())
                            Text(step["operation"]?.stringValue ?? "Unknown operation")
                                .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                        }
                    }
                }
                if case let .array(tools)? = value["requiredTools"], !tools.isEmpty {
                    Text("Required tools: \(tools.compactMap(\.stringValue).joined(separator: ", "))")
                        .font(.callout)
                    Text("Tool availability has not been checked by this preview. Inspect a saved plan before approving a step.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("Saving persists this recipe. Steps execute only after separate review and approval.")
                    .font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Advanced recipe JSON") { JSONEvidence(value: value) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ProductionStepRow: View {
    let step: ProductionStep
    let busy: Bool
    let onReview: () -> Void
    private var tint: Color {
        switch step.state {
        case .completed: .green
        case .ready: .blue
        case .blocked: .secondary
        case .invalidated: .orange
        case .uncertain: .orange
        }
    }
    private var symbol: String {
        switch step.state {
        case .completed: "checkmark.circle.fill"
        case .ready: "play.circle"
        case .blocked: "lock.circle"
        case .invalidated: "arrow.clockwise.circle"
        case .uncertain: "questionmark.circle"
        }
    }

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Label(step.id, systemImage: symbol).foregroundStyle(tint).font(.headline)
                    Text(step.state.rawValue.capitalized).font(.callout).foregroundStyle(tint)
                    Spacer()
                    if step.raw["status"]?.stringValue == "ready" {
                        Button("Review step", action: onReview).disabled(busy)
                            .accessibilityLabel("Review \(step.id), \(step.operation)")
                    }
                }
                Text(step.operation).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                if case let .array(dependencies)? = step.raw["dependsOn"], !dependencies.isEmpty {
                    Label("Depends on: \(dependencies.compactMap(\.stringValue).joined(separator: ", "))", systemImage: "arrow.turn.down.right")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(step.reasons, id: \.self) { reason in
                    Text(reason).font(.callout).textSelection(.enabled)
                }
                if let evidence = step.evidence {
                    DisclosureGroup("Recorded result and output paths") {
                        Text(evidence.formattedJSON).font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Step \(step.id), \(step.state.rawValue)")
    }
}
