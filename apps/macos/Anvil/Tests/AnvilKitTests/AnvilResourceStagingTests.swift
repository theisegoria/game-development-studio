import Foundation
import Testing
@testable import AnvilKit

@Suite("Standalone Anvil resource staging")
struct AnvilResourceStagingTests {
    private let schema = Data("{\"fixture_operation\":{\"type\":\"object\",\"properties\":{}}}".utf8)
    private var stager: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Tools/stage-resource-bundle.mjs")
    }
    private func invoke(_ arguments: [String]) throws -> Int32 {
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", stager.path] + arguments
        let output = Pipe(); process.standardOutput = output; process.standardError = output
        try process.run(); _ = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        return process.terminationStatus
    }
    private func fixture(structured: Bool) throws -> (root: URL, products: URL, resources: URL, canonical: URL, bundle: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("anvil-resource-\(UUID().uuidString)")
        let products = root.appendingPathComponent("build-products")
        let bundle = products.appendingPathComponent("Anvil_AnvilKit.bundle")
        let source = structured ? bundle.appendingPathComponent("Contents/Resources") : bundle
        let resources = root.appendingPathComponent("Standalone.app/Contents/Resources")
        for directory in [source, resources] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try schema.write(to: source.appendingPathComponent("roadmap-tool-schemas.json"))
        if structured {
            let plist: [String: String] = ["CFBundleIdentifier": "anvil.AnvilKit.resources", "CFBundleName": "Anvil_AnvilKit", "CFBundlePackageType": "BNDL"]
            try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
                .write(to: bundle.appendingPathComponent("Contents/Info.plist"))
        }
        let canonical = root.appendingPathComponent("canonical.json"); try schema.write(to: canonical)
        return (root, products, resources, canonical, bundle)
    }

    @Test("Staged flat and structured resources resolve without their original build products", arguments: [false, true])
    func resolvesWithoutBuildTree(structured: Bool) throws {
        let f = try fixture(structured: structured)
        defer { try? FileManager.default.removeItem(at: f.root) }
        #expect(try invoke(["--build-products", f.products.path, "--app-resources", f.resources.path, "--schema", f.canonical.path]) == 0)
        try FileManager.default.removeItem(at: f.products)
        #expect(!FileManager.default.fileExists(atPath: f.products.path))
        let loaded = RoadmapToolSchemas.load(appResources: f.resources)
        #expect(loaded["fixture_operation"]?["type"]?.stringValue == "object")
        #expect(try invoke(["--verify", f.resources.appendingPathComponent("Anvil_AnvilKit.bundle").path, "--schema", f.canonical.path]) == 0)
    }

    @Test("Unknown files, links and changed schemas cannot be staged", arguments: ["extra", "symlink", "changed", "missing"])
    func rejectsUnclosedResources(failure: String) throws {
        let f = try fixture(structured: false)
        defer { try? FileManager.default.removeItem(at: f.root) }
        let source = f.bundle.appendingPathComponent("roadmap-tool-schemas.json")
        switch failure {
        case "extra": try Data("unexpected".utf8).write(to: f.bundle.appendingPathComponent("helper"))
        case "symlink":
            try FileManager.default.removeItem(at: source)
            try FileManager.default.createSymbolicLink(at: source, withDestinationURL: f.canonical)
        case "changed": try Data("{}".utf8).write(to: source)
        default: try FileManager.default.removeItem(at: source)
        }
        #expect(try invoke(["--build-products", f.products.path, "--app-resources", f.resources.path, "--schema", f.canonical.path]) != 0)
        #expect(!FileManager.default.fileExists(atPath: f.resources.appendingPathComponent("Anvil_AnvilKit.bundle").path))
    }

    @Test("Missing standalone resources fail closed without a build-tree fallback")
    func missingResourcesAreUnavailable() throws {
        let f = try fixture(structured: true)
        defer { try? FileManager.default.removeItem(at: f.root) }
        #expect(RoadmapToolSchemas.load(appResources: f.resources).isEmpty)
    }
}
