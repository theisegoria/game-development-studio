import AnvilKit
import Foundation
import Observation
import OSLog

/// Application state: the runtime binding, toolchain health, and the run registry.
@MainActor
@Observable
final class AnvilModel {
    enum HealthState {
        case idle
        case checking
        case ready(DoctorReport)
        case failed(String)

        var isChecking: Bool {
            if case .checking = self { true } else { false }
        }
    }

    private(set) var health: HealthState = .idle
    private(set) var outputDirectory: URL
    let runs: RunStore

    // Scenario flow for the selected project. Written by AnvilModel+Scenarios.
    var scenarios: [ScenarioSummary] = []
    var scenarioList: ScenarioList?
    var plan: ScenarioPlan?
    var scenarioError: String?

    @ObservationIgnored private let client: GameDevCLIClient
    @ObservationIgnored private let runtimeURL: URL?
    @ObservationIgnored private var didStart = false
    @ObservationIgnored private static let logger = Logger(
        subsystem: "com.theisegoria.Anvil",
        category: "App"
    )

    init() {
        let runtimeURL = AnvilRuntime.bundledRuntimeURL()
        let client = GameDevCLIClient(executableURL: runtimeURL)
        let outputDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Anvil", isDirectory: true)

        self.runtimeURL = runtimeURL
        self.client = client
        self.outputDirectory = outputDirectory
        self.runs = RunStore(
            client: client,
            log: RunLog(root: (try? RunLog.defaultRoot())
                ?? FileManager.default.temporaryDirectory
                    .appendingPathComponent("anvil-runs", isDirectory: true))
        )
    }

    var hasRuntime: Bool { runtimeURL != nil }

    /// One-shot, buffered execution against the bound runtime. Used for the read-only
    /// commands that return a single envelope; anything long-running goes through the
    /// run store so it streams and is recorded.
    func execute(_ invocation: CLIInvocation, timeout: Duration) async throws -> CLIExecutionResult {
        try await client.execute(invocation, credentials: [:], timeout: timeout)
    }
    var runtimeDescription: String { runtimeURL?.path ?? "not found in this app bundle" }

    /// Idempotent: `.task` can fire again when the view is recreated.
    func start() async {
        guard !didStart else { return }
        didStart = true
        runs.restore()
        await refreshHealth()
        await loadScenarios()
    }

    func refreshHealth() async {
        guard runtimeURL != nil else {
            health = .failed(
                """
                Anvil could not find its bundled game-dev runtime. Build the app with \
                script/build_and_run_anvil.sh, which stages the pinned Node runtime into \
                Contents/Resources/\(AnvilRuntime.resourceDirectoryName).
                """
            )
            return
        }

        health = .checking
        let invocation = CLIInvocation(
            arguments: ["doctor", "--output-dir", outputDirectory.path, "--json"],
            expectedOperation: "doctor"
        )
        do {
            let result = try await client.execute(
                invocation,
                credentials: [:],
                timeout: .seconds(60)
            )
            health = .ready(try DoctorReport(data: result.envelope.data))
        } catch {
            Self.logger.error("doctor failed: \(error.localizedDescription, privacy: .public)")
            health = .failed(error.localizedDescription)
        }
    }
}
