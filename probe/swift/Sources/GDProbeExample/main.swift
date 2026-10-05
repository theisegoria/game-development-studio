// The minimal example, in Swift: a CPU-filled frame with two objects, the
// same picture probe/examples/minimal draws in C. Outside the harness it
// prints a line and exits 0; under `game-dev scenario run` it writes a capture.

import Foundation
import GDProbe

let width: UInt32 = 16
let height: UInt32 = 8
let brightness = UInt8(clamping: Int(CommandLine.arguments.dropFirst().first ?? "0") ?? 0)

var rgba = [UInt8](repeating: 0, count: Int(width * height * 4))
var ids = [UInt32](repeating: 0, count: Int(width * height))
for y in 0..<Int(height) {
    for x in 0..<Int(width) {
        let left = x < Int(width) / 2
        let offset = (y * Int(width) + x) * 4
        rgba[offset] = left ? 200 &+ brightness : 20
        rgba[offset + 1] = 40
        rgba[offset + 2] = left ? 20 : 200
        rgba[offset + 3] = 255
        ids[y * Int(width) + x] = left ? 1 : 2
    }
}

guard let run = ProbeRun() else {
    print("not attached to the harness; rendering normally")
    exit(0)
}

do {
    run.declareBackend(.unknown, device: "cpu-fill", driver: "swift-example", renderer: .software)
    try rgba.withUnsafeBytes { pixels in
        try ids.withUnsafeBufferPointer { idBuffer in
            try run.frame(0, label: "Main View") { frame in
                try frame.attachRGBA8(.color, pixels: pixels, width: width, height: height, rowStride: Int(width) * 4)
                try frame.attachIDs(ids: idBuffer, width: width, height: height, rowStride: Int(width) * 4)
            }
        }
    }
    for index in 0..<8 {
        try run.emit("performance", "frame_time", value: index == 0 ? 48 : 16, unit: "ms", frame: Int32(index), measuredBy: .wallClock)
    }
    // A software renderer may not claim GPU execution; the SDK refuses.
    if (try? run.attestGPU(.fenceSignalled, note: "should be refused")) != nil {
        FileHandle.standardError.write("sdk accepted a gpu attestation from a software renderer\n".data(using: .utf8)!)
        exit(1)
    }
    try run.finish()
} catch {
    FileHandle.standardError.write("probe failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
