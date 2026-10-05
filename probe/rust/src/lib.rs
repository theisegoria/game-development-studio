//! Safe Rust over the C probe SDK.
//!
//! Thin on purpose: the C library owns every invariant -- derived attachment
//! paths, slugified labels, the telemetry sequence, refusing GPU claims from a
//! software renderer, writing `capture.json` last -- and this crate makes those
//! calls safe and idiomatic. [`Run::begin`] and [`Session::open`] return
//! `Ok(None)` outside the harness, so an engine simply renders normally.

#![deny(unsafe_op_in_unsafe_fn)]

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::fmt;
use std::marker::PhantomData;
use std::ptr::{self, NonNull};

mod ffi {
    use std::ffi::{c_char, c_double, c_int, c_void};

    #[repr(C)]
    pub struct Run {
        _private: [u8; 0],
    }
    #[repr(C)]
    pub struct Frame {
        _private: [u8; 0],
    }
    #[repr(C)]
    pub struct Session {
        _private: [u8; 0],
    }

    pub type SnapshotFn = unsafe extern "C" fn(*mut c_void, *mut *const u8, *mut u32, *mut u32, *mut usize) -> c_int;
    pub type StateQueryFn = unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_char, usize) -> c_int;

    #[repr(C)]
    pub struct SessionHandlers {
        pub snapshot: Option<SnapshotFn>,
        pub state_query: Option<StateQueryFn>,
    }

    extern "C" {
        pub fn gdprobe_run_begin(out_status: *mut c_int) -> *mut Run;
        pub fn gdprobe_last_error(run: *const Run) -> *const c_char;
        pub fn gdprobe_declare_backend(run: *mut Run, backend: c_int, device: *const c_char, driver: *const c_char, class: c_int);
        pub fn gdprobe_attest_gpu(run: *mut Run, attestation: c_int, note: *const c_char) -> c_int;
        pub fn gdprobe_attest_performance(run: *mut Run, reported: c_int, note: *const c_char) -> c_int;
        pub fn gdprobe_frame_begin(run: *mut Run, index: u32, label: *const c_char) -> *mut Frame;
        pub fn gdprobe_attach_rgba8(frame: *mut Frame, kind: c_int, label: *const c_char, pixels: *const c_void,
                                    width: u32, height: u32, row_stride: usize) -> c_int;
        pub fn gdprobe_attach_ids(frame: *mut Frame, kind: c_int, label: *const c_char, ids: *const u32,
                                  width: u32, height: u32, row_stride: usize) -> c_int;
        pub fn gdprobe_frame_end(frame: *mut Frame);
        pub fn gdprobe_emit_measured(run: *mut Run, category: *const c_char, name: *const c_char, value: c_double,
                                     unit: *const c_char, frame_index: i32, measured_by: c_int) -> c_int;
        pub fn gdprobe_measure_measured(run: *mut Run, metric: *const c_char, value: c_double, unit: *const c_char,
                                        aggregation: *const c_char, frame_index: i32, measured_by: c_int) -> c_int;
        pub fn gdprobe_diagnostic(run: *mut Run, source: *const c_char, severity: c_int, message_id: *const c_char,
                                  message: *const c_char, frame_index: i32) -> c_int;
        pub fn gdprobe_span_reserve(run: *mut Run) -> u64;
        pub fn gdprobe_span_record(run: *mut Run, span_id: u64, parent_id: u64, name: *const c_char, frame_index: i32,
                                   start_ns: u64, duration_ns: u64, clock: c_int, measured_by: c_int) -> c_int;
        pub fn gdprobe_run_end(run: *mut Run) -> c_int;
        pub fn gdprobe_run_discard(run: *mut Run);

        pub fn gdprobe_session_open(out_status: *mut c_int) -> *mut Session;
        pub fn gdprobe_session_poll(session: *mut Session, handlers: *const SessionHandlers, user: *mut c_void,
                                    frame_index: i32) -> c_int;
        pub fn gdprobe_session_should_advance(session: *mut Session) -> c_int;
        pub fn gdprobe_session_closed(session: *const Session) -> c_int;
        pub fn gdprobe_session_close(session: *mut Session);
    }
}

const OK: c_int = 0;
const NOT_ATTACHED: c_int = 1;
const ERR_STATE: c_int = 3;
const ERR_LIMIT: c_int = 6;

/// A failure the SDK explained, with its own message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub status: i32,
    pub message: String,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "gdprobe status {}: {}", self.status, self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Backend { Unknown = 0, Metal, Vulkan, WebGpu, OpenGl }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum RendererClass { Unknown = 0, Hardware, Software }

/// How the engine knows the GPU finished, not merely that it believes it did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum GpuAttestation { NotAttested = 0, CommandBufferCompleted, FenceSignalled, TimestampResolved }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum AttachmentKind {
    Color = 0, Albedo, Depth, Normal, ObjectId, MaterialId, Motion, Overdraw, Wireframe, UvChecker,
    MipmapLevel, Stencil, ShaderComplexity, LightComplexity, Custom,
}

/// What measured a number. A GPU timestamp and a counter look identical as `f64`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum MeasuredBy { Unknown = 0, GpuTimestampQuery, PipelineStatisticsQuery, DriverReport, EngineCounter, WallClock }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Severity { Info = 0, Warning, Error }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum ClockDomain { Gpu = 0, Cpu }

/// Interior NULs cannot cross into C; they are replaced rather than panicking.
fn c(text: &str) -> CString {
    CString::new(text.replace('\0', " ")).expect("NULs were replaced")
}

fn frame_arg(frame: Option<u32>) -> i32 {
    frame.map_or(-1, |index| i32::try_from(index).unwrap_or(i32::MAX))
}

/// One capture run.
pub struct Run {
    raw: NonNull<ffi::Run>,
}

impl Run {
    /// `Ok(None)` outside the harness: not a failure, render normally.
    pub fn begin() -> Result<Option<Run>> {
        let mut status: c_int = OK;
        // SAFETY: plain FFI; a NULL result is documented and handled.
        let raw = unsafe { ffi::gdprobe_run_begin(&mut status) };
        match NonNull::new(raw) {
            Some(raw) => Ok(Some(Run { raw })),
            None if status == NOT_ATTACHED => Ok(None),
            None => Err(Error { status, message: "gdprobe_run_begin failed".into() }),
        }
    }

    fn error(&self, status: c_int) -> Error {
        // SAFETY: the run is live, and the SDK documents the message as never NULL.
        let message = unsafe { CStr::from_ptr(ffi::gdprobe_last_error(self.raw.as_ptr())) };
        Error { status, message: message.to_string_lossy().into_owned() }
    }

    fn check(&self, status: c_int) -> Result<()> {
        if status == OK { Ok(()) } else { Err(self.error(status)) }
    }

    pub fn declare_backend(&mut self, backend: Backend, device: &str, driver: &str, renderer: RendererClass) {
        let (device, driver) = (c(device), c(driver));
        // SAFETY: live run; the SDK copies the strings.
        unsafe { ffi::gdprobe_declare_backend(self.raw.as_ptr(), backend as c_int, device.as_ptr(), driver.as_ptr(), renderer as c_int) }
    }

    /// Refused when the declared renderer is software.
    pub fn attest_gpu(&mut self, attestation: GpuAttestation, note: &str) -> Result<()> {
        let note = c(note);
        // SAFETY: live run; the SDK copies the note.
        self.check(unsafe { ffi::gdprobe_attest_gpu(self.raw.as_ptr(), attestation as c_int, note.as_ptr()) })
    }

    pub fn attest_performance(&mut self, note: &str) -> Result<()> {
        let note = c(note);
        // SAFETY: live run.
        self.check(unsafe { ffi::gdprobe_attest_performance(self.raw.as_ptr(), 1, note.as_ptr()) })
    }

    /// Begin a frame. The frame ends when the returned value is dropped.
    pub fn frame(&mut self, index: u32, label: Option<&str>) -> Result<Frame<'_>> {
        let label = label.map(c);
        // SAFETY: live run; a NULL label is allowed.
        let raw = unsafe { ffi::gdprobe_frame_begin(self.raw.as_ptr(), index, label.as_ref().map_or(ptr::null(), |l| l.as_ptr())) };
        match NonNull::new(raw) {
            Some(raw) => Ok(Frame { raw, run: self.raw, _run: PhantomData }),
            None => Err(self.error(ERR_STATE)),
        }
    }

    pub fn emit(&mut self, category: &str, name: &str, value: f64, unit: &str, frame: Option<u32>, measured_by: MeasuredBy) -> Result<()> {
        let (category, name, unit) = (c(category), c(name), c(unit));
        // SAFETY: live run; strings outlive the call.
        self.check(unsafe {
            ffi::gdprobe_emit_measured(self.raw.as_ptr(), category.as_ptr(), name.as_ptr(), value, unit.as_ptr(), frame_arg(frame), measured_by as c_int)
        })
    }

    /// A value you already aggregated, e.g. a p99 you computed: say which with `aggregation`.
    pub fn measure(&mut self, metric: &str, value: f64, unit: &str, aggregation: &str, frame: Option<u32>, measured_by: MeasuredBy) -> Result<()> {
        let (metric, unit, aggregation) = (c(metric), c(unit), c(aggregation));
        // SAFETY: live run; strings outlive the call.
        self.check(unsafe {
            ffi::gdprobe_measure_measured(self.raw.as_ptr(), metric.as_ptr(), value, unit.as_ptr(), aggregation.as_ptr(), frame_arg(frame), measured_by as c_int)
        })
    }

    /// Route your validation layer or debug callback here.
    pub fn diagnostic(&mut self, source: &str, severity: Severity, message_id: Option<&str>, message: &str, frame: Option<u32>) -> Result<()> {
        let (source, message) = (c(source), c(message));
        let message_id = message_id.map(c);
        // SAFETY: live run; NULL message id is allowed.
        self.check(unsafe {
            ffi::gdprobe_diagnostic(self.raw.as_ptr(), source.as_ptr(), severity as c_int,
                                    message_id.as_ref().map_or(ptr::null(), |id| id.as_ptr()), message.as_ptr(), frame_arg(frame))
        })
    }

    /// Reserve an id so a parent span can be named before its own duration is known.
    pub fn reserve_span(&mut self) -> u64 {
        // SAFETY: live run.
        unsafe { ffi::gdprobe_span_reserve(self.raw.as_ptr()) }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn span(&mut self, id: u64, parent: Option<u64>, name: &str, frame: Option<u32>, start_ns: u64, duration_ns: u64,
                clock: ClockDomain, measured_by: MeasuredBy) -> Result<()> {
        let name = c(name);
        // SAFETY: live run.
        self.check(unsafe {
            ffi::gdprobe_span_record(self.raw.as_ptr(), id, parent.unwrap_or(0), name.as_ptr(), frame_arg(frame), start_ns, duration_ns,
                                     clock as c_int, measured_by as c_int)
        })
    }

    /// Write `capture.json` last and release the run.
    pub fn finish(self) -> Result<()> {
        let raw = self.raw;
        std::mem::forget(self);
        // SAFETY: the run is live and ownership moves to the SDK here.
        let status = unsafe { ffi::gdprobe_run_end(raw.as_ptr()) };
        if status == OK {
            return Ok(());
        }
        // On failure the SDK keeps the run so the reason is readable; read it, then discard.
        // SAFETY: still live after a failed end, per the SDK's contract.
        let message = unsafe { CStr::from_ptr(ffi::gdprobe_last_error(raw.as_ptr())) }.to_string_lossy().into_owned();
        unsafe { ffi::gdprobe_run_discard(raw.as_ptr()) };
        Err(Error { status, message })
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        // A run dropped without finish() writes no manifest: the harness sees a failed run.
        // SAFETY: live run, never used again.
        unsafe { ffi::gdprobe_run_discard(self.raw.as_ptr()) }
    }
}

/// An open frame. Attach images, then drop it.
pub struct Frame<'run> {
    raw: NonNull<ffi::Frame>,
    run: NonNull<ffi::Run>,
    _run: PhantomData<&'run mut Run>,
}

impl Frame<'_> {
    fn check(&self, status: c_int) -> Result<()> {
        if status == OK {
            return Ok(());
        }
        // SAFETY: the run outlives this frame by the borrow.
        let message = unsafe { CStr::from_ptr(ffi::gdprobe_last_error(self.run.as_ptr())) };
        Err(Error { status, message: message.to_string_lossy().into_owned() })
    }

    /// 8-bit RGBA. `row_stride` is bytes per row and is NOT assumed to be `width * 4`:
    /// wgpu pads readback rows to 256 bytes.
    pub fn attach_rgba8(&mut self, kind: AttachmentKind, label: Option<&str>, pixels: &[u8], width: u32, height: u32, row_stride: usize) -> Result<()> {
        let needed = row_stride.saturating_mul(height.saturating_sub(1) as usize).saturating_add(width as usize * 4);
        if height == 0 || row_stride < width as usize * 4 || pixels.len() < needed {
            return Err(Error { status: 2, message: "pixel buffer is smaller than width, height and row stride describe".into() });
        }
        let label = label.map(c);
        // SAFETY: the buffer was bounds-checked above and outlives the call.
        self.check(unsafe {
            ffi::gdprobe_attach_rgba8(self.raw.as_ptr(), kind as c_int, label.as_ref().map_or(ptr::null(), |l| l.as_ptr()),
                                      pixels.as_ptr().cast(), width, height, row_stride)
        })
    }

    /// 32-bit object or material ids; `row_stride` in BYTES. Id 0 means nothing.
    pub fn attach_ids(&mut self, kind: AttachmentKind, label: Option<&str>, ids: &[u32], width: u32, height: u32, row_stride: usize) -> Result<()> {
        let needed_bytes = row_stride.saturating_mul(height.saturating_sub(1) as usize).saturating_add(width as usize * 4);
        if height == 0 || row_stride < width as usize * 4 || ids.len() * 4 < needed_bytes {
            return Err(Error { status: 2, message: "id buffer is smaller than width, height and row stride describe".into() });
        }
        let label = label.map(c);
        // SAFETY: the buffer was bounds-checked above and outlives the call.
        self.check(unsafe {
            ffi::gdprobe_attach_ids(self.raw.as_ptr(), kind as c_int, label.as_ref().map_or(ptr::null(), |l| l.as_ptr()),
                                    ids.as_ptr(), width, height, row_stride)
        })
    }
}

impl Drop for Frame<'_> {
    fn drop(&mut self) {
        // SAFETY: live frame, never used again.
        unsafe { ffi::gdprobe_frame_end(self.raw.as_ptr()) }
    }
}

/// What the AI asked the running engine for. Implement both for a full session.
pub trait SessionHandler {
    /// The latest frame as RGBA8: `(pixels, width, height, row_stride_bytes)`.
    fn snapshot(&mut self) -> Option<(&[u8], u32, u32, usize)> { None }
    /// Answer from your scene graph with ONE JSON value, e.g. `{"visible":false}`.
    fn state_query(&mut self, _query: &str) -> Option<String> { None }
}

/// A live session. Never evidence: use it to find the problem, then capture a run to prove it.
pub struct Session {
    raw: NonNull<ffi::Session>,
}

unsafe extern "C" fn snapshot_trampoline(user: *mut c_void, pixels: *mut *const u8, width: *mut u32, height: *mut u32, stride: *mut usize) -> c_int {
    // SAFETY: `user` is the `&mut &mut dyn SessionHandler` passed to poll, valid for its duration.
    let handler = unsafe { &mut *(user as *mut &mut dyn SessionHandler) };
    match handler.snapshot() {
        Some((buffer, w, h, row_stride)) if !buffer.is_empty() => {
            // SAFETY: out-pointers come from the SDK and are valid for writes.
            unsafe {
                *pixels = buffer.as_ptr();
                *width = w;
                *height = h;
                *stride = row_stride;
            }
            OK
        }
        _ => ERR_STATE,
    }
}

unsafe extern "C" fn query_trampoline(user: *mut c_void, query: *const c_char, out: *mut c_char, capacity: usize) -> c_int {
    // SAFETY: as above; `query` is a NUL-terminated string owned by the SDK.
    let handler = unsafe { &mut *(user as *mut &mut dyn SessionHandler) };
    let query = unsafe { CStr::from_ptr(query) }.to_string_lossy();
    let Some(answer) = handler.state_query(&query) else { return ERR_STATE };
    let bytes = answer.as_bytes();
    if bytes.len() >= capacity || bytes.contains(&0) {
        return ERR_LIMIT;
    }
    // SAFETY: `out` has `capacity` bytes and the answer plus NUL fits.
    unsafe {
        ptr::copy_nonoverlapping(bytes.as_ptr(), out.cast::<u8>(), bytes.len());
        *out.add(bytes.len()) = 0;
    }
    OK
}

impl Session {
    /// `Ok(None)` outside a harness session.
    pub fn open() -> Result<Option<Session>> {
        let mut status: c_int = OK;
        // SAFETY: plain FFI; NULL is documented and handled.
        let raw = unsafe { ffi::gdprobe_session_open(&mut status) };
        match NonNull::new(raw) {
            Some(raw) => Ok(Some(Session { raw })),
            None if status == NOT_ATTACHED => Ok(None),
            None => Err(Error { status, message: "gdprobe_session_open failed".into() }),
        }
    }

    /// Never blocks. Call once per loop iteration.
    pub fn poll(&mut self, frame: u32, handler: &mut dyn SessionHandler) {
        let handlers = ffi::SessionHandlers { snapshot: Some(snapshot_trampoline), state_query: Some(query_trampoline) };
        let mut handler: &mut dyn SessionHandler = handler;
        let user = (&mut handler as *mut &mut dyn SessionHandler).cast::<c_void>();
        // SAFETY: handlers and user outlive the call; the SDK calls back synchronously.
        unsafe { ffi::gdprobe_session_poll(self.raw.as_ptr(), &handlers, user, frame_arg(Some(frame))) };
    }

    /// True when the engine should render its next frame: not paused, or stepping.
    pub fn should_advance(&mut self) -> bool {
        // SAFETY: live session.
        unsafe { ffi::gdprobe_session_should_advance(self.raw.as_ptr()) != 0 }
    }

    pub fn is_closed(&self) -> bool {
        // SAFETY: live session.
        unsafe { ffi::gdprobe_session_closed(self.raw.as_ptr()) != 0 }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: live session, never used again.
        unsafe { ffi::gdprobe_session_close(self.raw.as_ptr()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_the_harness_there_is_nothing_to_attach_to() {
        // cargo test has no GAME_DEV_RUN_DIR and no session socket.
        assert!(Run::begin().unwrap().is_none());
        assert!(Session::open().unwrap().is_none());
    }

    #[test]
    fn enum_values_match_the_c_abi() {
        assert_eq!(AttachmentKind::ObjectId as i32, 4);
        assert_eq!(MeasuredBy::WallClock as i32, 5);
        assert_eq!(GpuAttestation::TimestampResolved as i32, 3);
        assert_eq!(ClockDomain::Cpu as i32, 1);
        assert_eq!(Severity::Error as i32, 2);
    }

    #[test]
    fn interior_nuls_are_replaced_not_panicked_on() {
        assert_eq!(c("a\0b").to_str().unwrap(), "a b");
    }
}
