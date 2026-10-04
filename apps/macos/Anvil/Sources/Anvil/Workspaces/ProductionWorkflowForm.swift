import AnvilKit
import SwiftUI

struct ProductionWorkflowForm: View {
    @Binding var draft: ProductionWorkflowDraft

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
                        TextField("Clip index", value: $draft.clipIndex, format: .number)
                        TextField("Time in seconds", value: $draft.clipTimeSeconds, format: .number)
                        Text("Use a clip from the asset's recorded inventory. LINEAR/STEP samples support skinning and morph evaluation; unsupported clips are refused. Each settings change requires fresh review.")
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
}
