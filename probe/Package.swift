// swift-tools-version:5.9
//
// The probe SDK for Swift engines. It wraps the SAME C sources as every other
// language -- one ABI, one implementation of the bundle contract -- so a Swift
// engine and a C engine cannot disagree about what a valid capture is.
//
// Add it as a local or git package dependency and `import GDProbe`.
import PackageDescription

let package = Package(
    name: "GDProbe",
    products: [
        .library(name: "GDProbe", targets: ["GDProbe"]),
    ],
    targets: [
        .target(
            name: "CGDProbe",
            path: "c",
            sources: ["gdprobe.c", "gdprobe_session.c"],
            publicHeadersPath: "."
        ),
        .target(name: "GDProbe", dependencies: ["CGDProbe"], path: "swift/Sources/GDProbe"),
        .executableTarget(name: "GDProbeExample", dependencies: ["GDProbe"], path: "swift/Sources/GDProbeExample"),
        .testTarget(name: "GDProbeTests", dependencies: ["GDProbe"], path: "swift/Tests/GDProbeTests"),
    ]
)
