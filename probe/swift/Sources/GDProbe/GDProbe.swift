// Swift over the C probe SDK. Thin on purpose: the C library owns every
// invariant -- derived paths, slugified labels, the telemetry sequence,
// refusing GPU claims from a software renderer, writing capture.json last --
// and this file only makes those calls feel like Swift.

import CGDProbe
import Foundation

public enum ProbeError: Error, CustomStringConvertible {
    case failed(String)
    public var description: String {
        switch self { case .failed(let message): return message }
    }
}

public enum Backend: UInt32 { case unknown = 0, metal, vulkan, webgpu, opengl }
public enum RendererClass: UInt32 { case unknown = 0, hardware, software }
/// How the engine knows the GPU finished, not merely that it believes it did.
public enum GPUAttestation: UInt32 { case notAttested = 0, commandBufferCompleted, fenceSignalled, timestampResolved }
public enum AttachmentKind: UInt32 {
    case color = 0, albedo, depth, normal, objectID, materialID, motion, overdraw, wireframe, uvChecker,
         mipmapLevel, stencil, shaderComplexity, lightComplexity, custom
}
/// What measured a number. A GPU timestamp and a counter look identical as doubles.
public enum MeasuredBy: UInt32 {
    case unknown = 0, gpuTimestampQuery, pipelineStatisticsQuery, driverReport, engineCounter, wallClock
}
public enum Severity: UInt32 { case info = 0, warning, error }
public enum ClockDomain: UInt32 { case gpu = 0, cpu }

private func check(_ status: gdprobe_status, _ run: OpaquePointer?) throws {
    guard status == GDPROBE_OK else {
        let reason = run.map { String(cString: gdprobe_last_error($0)) } ?? "status \(status.rawValue)"
        throw ProbeError.failed(reason)
    }
}

/// One capture run. `ProbeRun()` is nil outside the harness: render normally then.
public final class ProbeRun {
    private var handle: OpaquePointer?

    public init?() {
        var status = GDPROBE_OK
        guard let run = gdprobe_run_begin(&status) else { return nil }
        handle = run
    }

    deinit {
        if let handle { gdprobe_run_discard(handle) }
    }

    public func declareBackend(_ backend: Backend, device: String, driver: String, renderer: RendererClass) {
        guard let handle else { return }
        gdprobe_declare_backend(handle, gdprobe_backend(backend.rawValue), device, driver, gdprobe_renderer_class(renderer.rawValue))
    }

    /// Refused -- and throws -- when the declared renderer is software.
    public func attestGPU(_ attestation: GPUAttestation, note: String) throws {
        try check(gdprobe_attest_gpu(handle, gdprobe_gpu_attestation(attestation.rawValue), note), handle)
    }

    public func attestPerformance(note: String) throws {
        try check(gdprobe_attest_performance(handle, 1, note), handle)
    }

    /// Begin a frame; attachments are added inside `body`, and the frame ends when it returns.
    public func frame(_ index: UInt32, label: String? = nil, _ body: (Frame) throws -> Void) throws {
        guard let frame = gdprobe_frame_begin(handle, index, label) else {
            throw ProbeError.failed(handle.map { String(cString: gdprobe_last_error($0)) } ?? "no run")
        }
        defer { gdprobe_frame_end(frame) }
        try body(Frame(handle: frame, run: handle))
    }

    public func emit(_ category: String, _ name: String, value: Double, unit: String,
                     frame: Int32 = -1, measuredBy: MeasuredBy = .unknown) throws {
        try check(gdprobe_emit_measured(handle, category, name, value, unit, frame, gdprobe_measured_by(measuredBy.rawValue)), handle)
    }

    public func diagnostic(source: String, severity: Severity, id: String? = nil, message: String, frame: Int32 = -1) throws {
        try check(gdprobe_diagnostic(handle, source, gdprobe_severity(severity.rawValue), id, message, frame), handle)
    }

    /// Reserve an id so a parent can be named before its own duration is known.
    public func reserveSpan() -> UInt64 { gdprobe_span_reserve(handle) }

    public func span(_ id: UInt64, parent: UInt64 = 0, name: String, frame: Int32, startNs: UInt64, durationNs: UInt64,
                     clock: ClockDomain, measuredBy: MeasuredBy) throws {
        try check(gdprobe_span_record(handle, id, parent, name, frame, startNs, durationNs,
                                      gdprobe_clock_domain(clock.rawValue), gdprobe_measured_by(measuredBy.rawValue)), handle)
    }

    /// Write capture.json last and release the run. After this the run is gone.
    public func finish() throws {
        guard let run = handle else { return }
        let status = gdprobe_run_end(run)
        if status == GDPROBE_OK {
            handle = nil
            return
        }
        throw ProbeError.failed(String(cString: gdprobe_last_error(run)))
    }

    public struct Frame {
        fileprivate let handle: OpaquePointer
        fileprivate let run: OpaquePointer?

        /// 8-bit RGBA. `rowStride` is bytes per row and is NOT assumed to be width * 4.
        public func attachRGBA8(_ kind: AttachmentKind, label: String? = nil, pixels: UnsafeRawBufferPointer,
                                width: UInt32, height: UInt32, rowStride: Int) throws {
            try check(gdprobe_attach_rgba8(handle, gdprobe_attachment_kind(kind.rawValue), label, pixels.baseAddress,
                                           width, height, rowStride), run)
        }

        public func attachIDs(_ kind: AttachmentKind = .objectID, label: String? = nil, ids: UnsafeBufferPointer<UInt32>,
                              width: UInt32, height: UInt32, rowStride: Int) throws {
            try check(gdprobe_attach_ids(handle, gdprobe_attachment_kind(kind.rawValue), label, ids.baseAddress,
                                         width, height, rowStride), run)
        }
    }
}

/// A live session: the AI talks to the running engine. Nil outside the harness. Never evidence.
public final class ProbeSession {
    public struct Snapshot {
        public let pixels: UnsafeRawBufferPointer
        public let width: UInt32
        public let height: UInt32
        public let rowStride: Int
        public init(pixels: UnsafeRawBufferPointer, width: UInt32, height: UInt32, rowStride: Int) {
            self.pixels = pixels; self.width = width; self.height = height; self.rowStride = rowStride
        }
    }

    private let handle: OpaquePointer
    /// Called while the SDK writes the PNG; the buffer need only live for the call.
    public var snapshot: (() -> Snapshot?)?
    /// Answer from your scene graph with one JSON value, e.g. `{"visible":false}`.
    public var stateQuery: ((String) -> String?)?

    public init?() {
        var status = GDPROBE_OK
        guard let session = gdprobe_session_open(&status) else { return nil }
        handle = session
    }

    deinit { gdprobe_session_close(handle) }

    public var isClosed: Bool { gdprobe_session_closed(handle) != 0 }
    /// True when the engine should render its next frame: not paused, or stepping.
    public func shouldAdvance() -> Bool { gdprobe_session_should_advance(handle) != 0 }

    /// Never blocks. Call once per loop iteration.
    public func poll(frame: Int32) {
        var handlers = gdprobe_session_handlers(
            snapshot: { user, pixels, width, height, stride in
                let session = Unmanaged<ProbeSession>.fromOpaque(user!).takeUnretainedValue()
                guard let shot = session.snapshot?(), let base = shot.pixels.baseAddress else { return GDPROBE_ERR_STATE }
                pixels?.pointee = base.assumingMemoryBound(to: UInt8.self)
                width?.pointee = shot.width
                height?.pointee = shot.height
                stride?.pointee = shot.rowStride
                return GDPROBE_OK
            },
            state_query: { user, query, out, capacity in
                let session = Unmanaged<ProbeSession>.fromOpaque(user!).takeUnretainedValue()
                guard let query, let out, let answer = session.stateQuery?(String(cString: query)) else { return GDPROBE_ERR_STATE }
                let bytes = Array(answer.utf8)
                guard bytes.count < capacity else { return GDPROBE_ERR_LIMIT }
                bytes.withUnsafeBufferPointer { buffer in
                    out.withMemoryRebound(to: UInt8.self, capacity: capacity) { $0.update(from: buffer.baseAddress!, count: bytes.count) }
                }
                out[bytes.count] = 0
                return GDPROBE_OK
            }
        )
        let user = Unmanaged.passUnretained(self).toOpaque()
        _ = gdprobe_session_poll(handle, &handlers, user, frame)
    }
}
