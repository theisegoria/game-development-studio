import SwiftUI
import AppKit

struct LocalRasterView: View {
    let path: String
    @State private var image: NSImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let image { Image(nsImage: image).resizable().interpolation(.none).aspectRatio(contentMode: .fit) }
            else if failed { ContentUnavailableView("Image unavailable", systemImage: "photo.badge.exclamationmark", description: Text(path)) }
            else { ProgressView("Loading attachment") }
        }
        .accessibilityLabel(URL(fileURLWithPath: path).lastPathComponent)
        .task(id: path) {
            image = nil; failed = false
            let filename = path
            let bytes = await Task.detached(priority: .userInitiated) { () -> Data? in
                let url = URL(fileURLWithPath: filename)
                guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
                      values.isRegularFile == true, values.isSymbolicLink != true,
                      let size = values.fileSize, size <= 128 * 1024 * 1024 else { return nil }
                return try? Data(contentsOf: url)
            }.value
            guard !Task.isCancelled else { return }
            image = bytes.flatMap { NSImage(data: $0) }; failed = image == nil
        }
    }
}

struct CaptureAnalysisView: View {
    let analysis: CaptureAnalysisModel
    @State private var selected = ""
    var body: some View {
        MaterialCard(title: "Capture attachments", systemImage: "photo.stack") {
            Picker("Frame and attachment", selection: $selected) {
                ForEach(analysis.rasters) { Text("Frame \($0.frameIndex) · \($0.kind) \($0.label ?? "")").tag($0.id) }
            }
            if let raster = analysis.rasters.first(where: { $0.id == selected }) ?? analysis.rasters.first {
                LocalRasterView(path: raster.path).frame(height: 300)
                Text("\(raster.width) × \(raster.height) · luminance \(raster.meanLuminance, format: .number.precision(.fractionLength(3))) · alpha coverage \(raster.alphaCoverage, format: .percent)")
                    .font(.caption).textSelection(.enabled)
                if let ids = raster.uniqueSemanticIds { Text("\(ids) semantic IDs").font(.caption) }
            } else { Text("No supported PNG attachments.") }
            if !analysis.unsupportedAttachments.isEmpty { Text("Unsupported attachments: \(analysis.unsupportedAttachments.joined(separator: ", "))").font(.caption) }
            EvidenceNote(text: analysis.evidenceCeiling)
        }
        .task(id: analysis.runId) { selected = analysis.rasters.first?.id ?? "" }
    }
}

struct VisualComparisonView: View {
    let comparison: VisualComparisonModel
    @State private var selected = ""
    @State private var mode = "Side by side"
    @State private var split = 0.5
    @State private var zoom = 1.0
    @State private var offset = CGSize.zero
    @State private var dragOrigin = CGSize.zero
    private var pair: VisualPair? { comparison.pairs.first(where: { $0.id == selected }) ?? comparison.pairs.first }
    var body: some View {
        MaterialCard(title: "Visual comparison", systemImage: "rectangle.split.2x1") {
            Picker("Attachment", selection: $selected) {
                ForEach(comparison.pairs) { Text($0.identity).tag($0.id) }
            }
            Picker("View", selection: $mode) {
                ForEach(["Side by side", "Slider", "Heatmap"], id: \.self) { Text($0).tag($0) }
            }.pickerStyle(.segmented)
            if let pair {
                if !pair.comparable { Label(pair.reason ?? "Incompatible attachments", systemImage: "exclamationmark.triangle") }
                GeometryReader { geometry in
                    Group {
                        if mode == "Heatmap" {
                            if let heatmap = pair.heatmapPath { LocalRasterView(path: heatmap) }
                            else { ContentUnavailableView("Export to generate heatmaps", systemImage: "square.and.arrow.down", description: Text("Choose a new comparison output directory above.")) }
                        } else if mode == "Slider" {
                            ZStack {
                                LocalRasterView(path: pair.baselinePath)
                                LocalRasterView(path: pair.candidatePath)
                                    .mask(alignment: .leading) { Rectangle().frame(width: geometry.size.width * split) }
                            }
                        } else {
                            HStack {
                                VStack { Text("Baseline").font(.caption); LocalRasterView(path: pair.baselinePath) }
                                VStack { Text("Candidate").font(.caption); LocalRasterView(path: pair.candidatePath) }
                            }
                        }
                    }
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .scaleEffect(zoom).offset(offset)
                    .gesture(DragGesture().onChanged { offset = CGSize(width: dragOrigin.width + $0.translation.width, height: dragOrigin.height + $0.translation.height) }.onEnded { _ in dragOrigin = offset })
                }.frame(height: 340).clipped()
                if mode == "Slider" { Slider(value: $split, in: 0...1) { Text("Comparison split") } }
                HStack {
                    Text("Zoom")
                    Slider(value: $zoom, in: 1...8)
                    Button("Reset View") { zoom = 1; offset = .zero; dragOrigin = .zero; split = 0.5 }
                }
                Text("Changed pixels: \(pair.changedPixelRatio ?? 0, format: .percent) · Mean absolute error: \(pair.meanAbsoluteError ?? 0, format: .number.precision(.fractionLength(3)))")
                    .font(.caption)
                ForEach(pair.semanticRegions ?? []) { region in
                    Text("Object \(region.objectId): \(region.pixels) pixels · changed \(region.changedPixelRatio, format: .percent)").font(.caption)
                }
            }
            if !comparison.unmatchedBaseline.isEmpty || !comparison.unmatchedCandidate.isEmpty {
                Label("Missing attachments — baseline: \(comparison.unmatchedBaseline.joined(separator: ", ")); candidate: \(comparison.unmatchedCandidate.joined(separator: ", "))", systemImage: "exclamationmark.triangle")
            }
            if let output = comparison.outputPath { Text("Exported report and images: \(output)").font(.caption).textSelection(.enabled) }
            if !comparison.unsupportedAttachments.isEmpty { Text("Unsupported attachments: \(comparison.unsupportedAttachments.joined(separator: ", "))").font(.caption) }
            EvidenceNote(text: comparison.evidenceCeiling)
        }
        .task(id: comparison.baselineRunId + comparison.candidateRunId) { selected = comparison.pairs.first?.id ?? "" }
        .onChange(of: selected) { _, _ in zoom = 1; offset = .zero; dragOrigin = .zero }
    }
}
