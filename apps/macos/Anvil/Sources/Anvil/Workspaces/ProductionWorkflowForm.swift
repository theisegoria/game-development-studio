import AnvilKit
import Foundation
import SwiftUI

struct ProductionWorkflowForm: View {
    @Binding var draft: ProductionWorkflowDraft
    let animationSources: [ProductionAnimationSourceInfo]
    let animationInspectionAvailable: Bool
    let inspectingAnimation: Bool
    let onInspectAnimation: () -> Void

    private var animationTimeline: ProductionAnimationTimeline? {
        guard let paths = try? draft.candidateModelPaths() else { return nil }
        return try? ProductionAnimationTimeline(sources: animationSources, matching: paths)
    }

    var body: some View {
        Form {
            Picker("Task", selection: $draft.template) {
                ForEach(ProductionWorkflowDraft.Template.allCases) { template in
                    Text(template.title).tag(template)
                }
            }
            TextField("Recipe ID", text: $draft.recipeID)
                .help("Use a stable ID to inspect and recover this workflow later.")
            TextField("Asset name", text: $draft.name)
            TextField("Asset license", text: $draft.license)
                .help("Enter the license that applies to the source asset.")
            if draft.template == .review {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Candidate model paths (one per line, up to six)")
                    TextEditor(text: $draft.candidatePaths)
                        .font(.system(.body, design: .monospaced)).frame(height: 82)
                        .accessibilityLabel("Candidate model paths, one absolute path per line")
                }
                Picker("Review view", selection: $draft.reviewMode) {
                    Text("Geometry").tag("geometry")
                    Text("Texture-mapped appearance").tag("appearance")
                }
                Picker("Preview resolution", selection: $draft.reviewResolution) {
                    Text("128 pixels").tag(128); Text("256 pixels").tag(256)
                }
                if draft.reviewMode == "appearance" {
                    TextField("Exposure (0.25–4)", value: $draft.reviewExposure, format: .number)
                }
                TextField("Review LOD label (optional)", text: $draft.reviewLod)
                    .help("Name the supplied asset's review LOD. This label does not generate a LOD.")
                DisclosureGroup("Animation sample") {
                    Toggle("Sample a clip at a fixed time", isOn: $draft.sampleAnimation)
                    if draft.sampleAnimation {
                        animationControls
                        Text("Inspection reads clip metadata from the supplied GLBs. Moving the playhead changes the next review request; it never renders or runs a recipe step by itself.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text("Controlled-lighting CPU previews aid review. Technical previews do not establish target-engine correctness or artistic acceptance.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                TextField("Absolute model path", text: $draft.modelPath)
                    .help(draft.template == .inspect ? "The free package workflow requires a self-contained GLB." : "Platform normalization accepts GLB or glTF.")
            }
            if draft.template == .platform {
                TextField("Variant ID", text: $draft.variantID)
                TextField("LOD triangle budgets", text: $draft.lodTriangles)
                    .help("Comma separated, for example 20000, 10000. The advanced view supports multiple variants.")
                TextField("Maximum materials", value: $draft.maxMaterials, format: .number)
                TextField("Maximum texture dimension", value: $draft.maxTextureSize, format: .number)
                Picker("Textures", selection: $draft.textureMode) {
                    Text("Preserve").tag("preserve"); Text("Resize").tag("resize"); Text("Compress").tag("compress")
                }
                Picker("Materials", selection: $draft.materialMode) {
                    Text("Preserve").tag("preserve"); Text("Normalize opaque").tag("opaque")
                }
                Picker("Collision", selection: $draft.collision) {
                    Text("None").tag("none"); Text("Conservative box").tag("box"); Text("Convex parts").tag("convex")
                }
                Text("Platform preparation uses optional tools. Their current availability is checked by the runtime; each step requires a separate review.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.columns)
    }

    @ViewBuilder
    private var animationControls: some View {
        HStack {
            Button(inspectingAnimation ? "Inspecting clips…" : "Inspect candidate clips") {
                onInspectAnimation()
            }
            .disabled(!animationInspectionAvailable || inspectingAnimation)
            .accessibilityHint("Reads animation metadata from each candidate GLB without rendering a preview.")
            if inspectingAnimation { ProgressView().controlSize(.small) }
        }
        if !animationInspectionAvailable {
            Text("The read-only CPU animation inspector is unavailable in this runtime.")
                .font(.caption).foregroundStyle(.orange)
        }

        if let animationTimeline {
            if animationTimeline.clips.isEmpty {
                Text("No clip index is supported by every candidate. Turn off animation sampling or use candidates with compatible clips.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Picker("Animation clip", selection: $draft.clipIndex) {
                    Text("Choose a clip").tag(-1)
                    ForEach(animationTimeline.clips) { clip in
                        Text(clipPickerTitle(clip)).tag(clip.index)
                    }
                }
                .accessibilityLabel("Animation clip index")
                .accessibilityHint("Selects the same clip index in every candidate. Missing or different clip names require a separate confirmation.")

                if let clip = animationTimeline.clip(at: draft.clipIndex) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Sample time")
                            Spacer()
                            Text("\(seconds(draft.clipTimeSeconds)) s / \(seconds(clip.minimumDurationSeconds)) s")
                                .monospacedDigit()
                                .accessibilityLabel("\(seconds(draft.clipTimeSeconds)) seconds of \(seconds(clip.minimumDurationSeconds)) seconds")
                        }
                        if clip.minimumDurationSeconds > 0 {
                            Slider(
                                value: $draft.clipTimeSeconds,
                                in: 0...clip.minimumDurationSeconds,
                                step: min(0.01, clip.minimumDurationSeconds)
                            )
                            .accessibilityLabel("Animation sample time")
                            .accessibilityValue(Text("\(seconds(draft.clipTimeSeconds)) seconds"))
                            .accessibilityHint("Use the arrow keys to adjust the sample time. The value is bounded by the shortest inspected candidate clip.")
                        } else {
                            Text("This clip has one sample time: 0 seconds.")
                                .accessibilityLabel("Animation sample time")
                                .accessibilityValue("0 seconds")
                        }
                    }
                    if !animationTimeline.contains(timeSeconds: draft.clipTimeSeconds, for: clip.index) {
                        HStack {
                            Text("The saved sample time is outside the refreshed clip duration.")
                                .font(.caption).foregroundStyle(.orange)
                            Button("Move to clip end") { draft.clipTimeSeconds = clip.minimumDurationSeconds }
                                .accessibilityHint("Sets the sample time to the shortest inspected candidate duration.")
                        }
                    }

                    if let key = animationTimeline.nameMappingConfirmationKey(at: clip.index) {
                        Toggle(
                            "I intend to sample clip index \(clip.index) across clips with missing or different names",
                            isOn: Binding(
                                get: { draft.confirmedAnimationClipMapping == key },
                                set: { draft.confirmedAnimationClipMapping = $0 ? key : nil }
                            )
                        )
                        .accessibilityHint("Confirms that the same numeric clip index should be sampled in each candidate when their names are missing or different.")
                        Text("This index has missing or different names across candidates: \(clip.candidateNames.map { $0.isEmpty ? "Unnamed clip" : $0 }.joined(separator: " · ")). Review those names before confirming.")
                            .font(.caption).foregroundStyle(.orange)
                    }

                    ForEach(animationTimeline.sources) { source in
                        let clipInfo = source.clips.first { $0.index == clip.index }
                        Text("\(source.modelPath): \(clipInfo?.displayName ?? "Unknown clip") · \(clipInfo?.channels ?? 0) channels · \(clipInfo?.interpolations.joined(separator: ", ") ?? "unknown") · \(source.renderer.id) v\(source.renderer.version), \(source.renderer.lighting) · SHA-256 \(source.sourceSHA256.prefix(12))…")
                            .font(.caption.monospaced()).textSelection(.enabled)
                    }
                    Text("Time range uses the shortest actual clip duration across \(animationTimeline.sources.count) candidate(s). Select Preview workflow to refresh metadata and create a new review request.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Choose a supported clip index from the inspected candidates.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(animationTimeline.sources) { source in
                    ForEach(source.warnings, id: \.self) { warning in
                        Text("\(source.modelPath): \(warning)").font(.caption).foregroundStyle(.orange)
                    }
                }
            }
        } else if animationSources.isEmpty {
            Text("Inspect candidate clips to load real names, durations and interpolation support.")
                .font(.caption).foregroundStyle(.secondary)
        } else {
            Text("Animation metadata no longer matches the candidate paths. Inspect the current candidates again.")
                .font(.caption).foregroundStyle(.orange)
        }
    }

    private func clipPickerTitle(_ clip: ProductionAnimationTimeline.Clip) -> String {
        let presentationNames = clip.candidateNames.map { $0.isEmpty ? "Unnamed clip" : $0 }
        let names = clip.namesMatch ? (presentationNames.first ?? "Unnamed clip") : presentationNames.joined(separator: " / ")
        return "Clip \(clip.index) · \(names) · ≤\(seconds(clip.minimumDurationSeconds)) s"
    }

    private func seconds(_ value: Double) -> String { String(format: "%.2f", value) }
}
