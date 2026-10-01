import AnvilKit
import AppKit
import Foundation

/// The project a window is working in, and the scenario flow that reads from it.
///
/// A project is the folder holding `.game-dev/adapter.json`. Anvil remembers the last
/// one chosen; it never guesses one from the working directory, which is wherever Anvil
/// happened to be launched from.
extension AnvilModel {
    private static let projectKey = "anvil.projectPath"

    var projectPath: String {
        get { UserDefaults.standard.string(forKey: Self.projectKey) ?? "" }
    }

    func setProject(_ url: URL) {
        UserDefaults.standard.set(url.path, forKey: Self.projectKey)
        scenarioRequestID = UUID()
        scenarioParameters = "{}"
        plannedProject = nil
        plannedParameters = nil
        plannedAdapterHash = nil
        scenarios = []
        scenarioList = nil
        plan = nil
        scenarioError = nil
        Task { await loadScenarios() }
    }

    /// Asks for a project folder. Anvil never reads a project it was not pointed at.
    func chooseProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use Project"
        panel.message = "Choose the game project folder. It should contain .game-dev/adapter.json, or you can install an adapter from Setup."
        if panel.runModal() == .OK, let url = panel.url {
            setProject(url)
        }
    }

    func loadScenarios() async {
        let project = projectPath
        guard !project.isEmpty else { return }
        scenarioError = nil
        do {
            let result = try await execute(
                CLIInvocation(
                    arguments: ["scenario", "list", "--project", project, "--output-dir", outputDirectory.path, "--json"],
                    expectedOperation: "scenario.list"
                ),
                timeout: .seconds(30)
            )
            guard project == projectPath else { return }
            guard result.envelope.ok else {
                scenarioError = result.envelope.summary
                scenarios = []
                return
            }
            let list = try ScenarioList(payload: result.envelope.data)
            scenarioList = list
            scenarios = list.scenarios
        } catch {
            guard project == projectPath else { return }
            scenarioError = error.localizedDescription
            scenarios = []
        }
    }

    func planScenario(_ scenarioID: String) async {
        let requestID = UUID()
        scenarioRequestID = requestID
        let parameters = scenarioParameters
        plan = nil
        plannedProject = nil
        plannedParameters = nil
        plannedAdapterHash = nil
        let project = projectPath
        guard !project.isEmpty else { return }
        scenarioError = nil
        do {
            let result = try await execute(
                CLIInvocation(
                    arguments: ["scenario", "plan", scenarioID, "--project", project, "--input", parameters, "--output-dir", outputDirectory.path, "--json"],
                    expectedOperation: "scenario.plan"
                ),
                timeout: .seconds(30)
            )
            guard project == projectPath, scenarioRequestID == requestID else { return }
            guard result.envelope.ok else {
                scenarioError = result.envelope.summary
                plan = nil
                return
            }
            guard project == projectPath, scenarioRequestID == requestID else { return }
            plan = try ScenarioPlan(planPayload: result.envelope.data)
            plannedProject = project
            plannedParameters = parameters
            plannedAdapterHash = result.envelope.data["adapterManifestSha256"]?.stringValue
        } catch {
            guard project == projectPath, scenarioRequestID == requestID else { return }
            // A plan Anvil cannot fully describe is not shown at all - approving it
            // would show a person less than they are agreeing to.
            scenarioError = error.localizedDescription
            plan = nil
        }
    }

    /// Starts the run the person just approved. The grant is the only way the
    /// authority flags reach the command line.
    func runScenario(_ plan: ScenarioPlan, grant: ApprovalGrant) {
        guard self.plan == plan,
              let project = plannedProject, project == projectPath,
              let parameters = plannedParameters,
              let adapterHash = plannedAdapterHash,
              let spec = CommandCatalog["scenario.run"] else { return }
        do {
            try runs.start(
                spec,
                arguments: [plan.scenarioID, "--project", project, "--input", parameters, "--expected-adapter-sha256", adapterHash],
                outputDirectory: outputDirectory,
                grant: grant,
                timeout: .seconds(Double(plan.timeoutSeconds) + 60)
            )
            self.plan = nil
        } catch {
            scenarioError = error.localizedDescription
        }
    }
}
