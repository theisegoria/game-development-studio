//! A thin binding to the C probe SDK. Deliberately small: the SDK owns every
//! invariant (paths, sequence numbers, attestation refusal), and this file
//! only carries calls across the FFI boundary.

#![allow(dead_code)]

use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};

pub const NOT_ATTACHED: c_int = 1;

pub const BACKEND_WEBGPU: c_int = 3;
pub const RENDERER_HARDWARE: c_int = 1;
pub const RENDERER_SOFTWARE: c_int = 2;
pub const GPU_FENCE_SIGNALLED: c_int = 2;
pub const GPU_TIMESTAMP_RESOLVED: c_int = 3;
pub const KIND_COLOR: c_int = 0;
pub const KIND_OBJECT_ID: c_int = 4;
pub const MEASURED_GPU_TIMESTAMP_QUERY: c_int = 1;
pub const MEASURED_PIPELINE_STATISTICS_QUERY: c_int = 2;
pub const MEASURED_DRIVER_REPORT: c_int = 3;
pub const MEASURED_ENGINE_COUNTER: c_int = 4;
pub const MEASURED_WALL_CLOCK: c_int = 5;

#[repr(C)]
pub struct Run { _private: [u8; 0] }
#[repr(C)]
pub struct Frame { _private: [u8; 0] }

extern "C" {
    pub fn gdprobe_run_begin(out_status: *mut c_int) -> *mut Run;
    pub fn gdprobe_last_error(run: *const Run) -> *const c_char;
    pub fn gdprobe_declare_backend(run: *mut Run, backend: c_int, device: *const c_char, driver: *const c_char, class: c_int);
    pub fn gdprobe_attest_gpu(run: *mut Run, attestation: c_int, note: *const c_char) -> c_int;
    pub fn gdprobe_attest_performance(run: *mut Run, reported: c_int, note: *const c_char) -> c_int;
    pub fn gdprobe_frame_begin(run: *mut Run, index: u32, label: *const c_char) -> *mut Frame;
    pub fn gdprobe_attach_rgba8(frame: *mut Frame, kind: c_int, label: *const c_char, pixels: *const c_void, width: u32, height: u32, row_stride: usize) -> c_int;
    pub fn gdprobe_attach_ids(frame: *mut Frame, kind: c_int, label: *const c_char, ids: *const u32, width: u32, height: u32, row_stride: usize) -> c_int;
    pub fn gdprobe_frame_end(frame: *mut Frame);
    pub fn gdprobe_emit_measured(run: *mut Run, category: *const c_char, name: *const c_char, value: c_double, unit: *const c_char, frame_index: i32, measured_by: c_int) -> c_int;
    pub fn gdprobe_measure_measured(run: *mut Run, metric: *const c_char, value: c_double, unit: *const c_char, aggregation: *const c_char, frame_index: i32, measured_by: c_int) -> c_int;
    pub fn gdprobe_run_end(run: *mut Run) -> c_int;
    pub fn gdprobe_run_discard(run: *mut Run);
}

pub fn c(text: &str) -> CString {
    CString::new(text).expect("no interior NUL")
}

pub fn last_error(run: *const Run) -> String {
    // SAFETY: the SDK documents that the pointer is never NULL for a live run.
    unsafe { CStr::from_ptr(gdprobe_last_error(run)).to_string_lossy().into_owned() }
}
