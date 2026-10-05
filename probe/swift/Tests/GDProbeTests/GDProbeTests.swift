import GDProbe
import Testing

@Suite("Swift probe wrapper")
struct GDProbeTests {
    @Test("is nil outside the harness, so an engine just renders")
    func notAttached() {
        // The test process has no GAME_DEV_RUN_DIR or session socket.
        #expect(ProbeRun() == nil)
        #expect(ProbeSession() == nil)
    }

    @Test("enum values match the C ABI they are passed across")
    func abi() {
        #expect(AttachmentKind.objectID.rawValue == 4)
        #expect(MeasuredBy.wallClock.rawValue == 5)
        #expect(GPUAttestation.timestampResolved.rawValue == 3)
        #expect(Backend.opengl.rawValue == 4)
    }
}
