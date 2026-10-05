/*
 * gdprobe -- write a Game Development Studio capture bundle from your engine.
 *
 * WHY THIS EXISTS. The harness contract is four environment variables and a
 * capture manifest. That is a small contract, and every engine that implements
 * it by hand gets the same handful of things wrong: labels that are not
 * lowercase identifiers, a telemetry sequence that is not strictly increasing,
 * a manifest written before the files it names, a row stride assumed to equal
 * width times bytes-per-pixel. Each one fails validation after the run, when
 * the frame is gone.
 *
 * So this library's job is not convenience. It is to make an invalid bundle
 * unrepresentable: the engine cannot name a path, cannot choose a sequence
 * number, and cannot write the manifest early.
 *
 * WHAT IT IS NOT. It never touches a graphics API. You synchronise, you read
 * back, you hand over a pointer and say how you know the GPU finished. Keeping
 * that boundary means one implementation serves Metal, Vulkan, WebGPU and GL
 * without knowing which one you used.
 *
 * C99, libc only. Compile gdprobe.c into your engine; there is nothing to link
 * and nothing to install.
 *
 * USAGE
 *
 *   gdprobe_run *run = gdprobe_run_begin(NULL);
 *   if (!run) { ... not running under the harness ... }
 *   gdprobe_declare_backend(run, GDPROBE_BACKEND_VULKAN, "llvmpipe", "24.0",
 *                           GDPROBE_RENDERER_SOFTWARE);
 *
 *   gdprobe_frame *frame = gdprobe_frame_begin(run, 0, "main");
 *   gdprobe_attach_rgba8(frame, GDPROBE_KIND_COLOR, NULL, pixels, w, h, stride);
 *   gdprobe_frame_end(frame);
 *
 *   gdprobe_emit(run, "performance", "frame_time", 16.7, "ms", 0);
 *   gdprobe_attest_gpu(run, GDPROBE_GPU_FENCE_SIGNALLED, "vkWaitForFences");
 *   gdprobe_run_end(run);
 */

#ifndef GDPROBE_H
#define GDPROBE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define GDPROBE_CONTRACT_VERSION "1"

typedef enum {
  GDPROBE_OK = 0,
  /* Not running under the harness: GAME_DEV_RUN_DIR and friends are absent.
     This is not a failure. An engine should carry on rendering. */
  GDPROBE_NOT_ATTACHED,
  GDPROBE_ERR_ARGUMENT,
  GDPROBE_ERR_STATE,
  GDPROBE_ERR_IO,
  GDPROBE_ERR_MEMORY,
  GDPROBE_ERR_LIMIT
} gdprobe_status;

typedef enum {
  GDPROBE_BACKEND_UNKNOWN = 0,
  GDPROBE_BACKEND_METAL,
  GDPROBE_BACKEND_VULKAN,
  GDPROBE_BACKEND_WEBGPU,
  GDPROBE_BACKEND_OPENGL
} gdprobe_backend;

/*
 * Whether real hardware drew this.
 *
 * Declare SOFTWARE for lavapipe, llvmpipe or SwiftShader. The harness refuses
 * every GPU and hardware-timing claim on a software run regardless of what
 * else you report, so declaring it honestly costs you nothing you were
 * entitled to and keeps the run's evidence truthful.
 */
typedef enum {
  GDPROBE_RENDERER_UNKNOWN = 0,
  GDPROBE_RENDERER_HARDWARE,
  GDPROBE_RENDERER_SOFTWARE
} gdprobe_renderer_class;

/*
 * HOW you know the GPU finished, not merely that you believe it did.
 *
 * An enum rather than a boolean on purpose: "I called waitUntilCompleted and
 * checked the status" and "I assume it worked" are different claims, and a
 * reader of the sealed run deserves to see which one was made.
 */
typedef enum {
  GDPROBE_GPU_NOT_ATTESTED = 0,
  GDPROBE_GPU_COMMANDBUFFER_COMPLETED,
  GDPROBE_GPU_FENCE_SIGNALLED,
  GDPROBE_GPU_TIMESTAMP_RESOLVED
} gdprobe_gpu_attestation;

/* Mirrors the harness attachment kinds. */
typedef enum {
  GDPROBE_KIND_COLOR = 0,
  GDPROBE_KIND_ALBEDO,
  GDPROBE_KIND_DEPTH,
  GDPROBE_KIND_NORMAL,
  GDPROBE_KIND_OBJECT_ID,
  GDPROBE_KIND_MATERIAL_ID,
  GDPROBE_KIND_MOTION,
  GDPROBE_KIND_OVERDRAW,
  GDPROBE_KIND_WIREFRAME,
  GDPROBE_KIND_UV_CHECKER,
  GDPROBE_KIND_MIPMAP_LEVEL,
  GDPROBE_KIND_STENCIL,
  GDPROBE_KIND_SHADER_COMPLEXITY,
  GDPROBE_KIND_LIGHT_COMPLEXITY,
  GDPROBE_KIND_CUSTOM
} gdprobe_attachment_kind;

typedef struct gdprobe_run gdprobe_run;
typedef struct gdprobe_frame gdprobe_frame;

/*
 * Open a run against the directory the harness supplied.
 *
 * Returns NULL and sets *out_status to GDPROBE_NOT_ATTACHED when the
 * GAME_DEV_* variables are absent, so the same binary runs normally outside
 * the harness. out_status may be NULL.
 */
gdprobe_run *gdprobe_run_begin(gdprobe_status *out_status);

/* Human-readable reason for the last failure on this run. Never NULL. */
const char *gdprobe_last_error(const gdprobe_run *run);

void gdprobe_declare_backend(gdprobe_run *run,
                             gdprobe_backend backend,
                             const char *device_name,
                             const char *driver_version,
                             gdprobe_renderer_class renderer_class);

/* `note` records how the attestation was obtained; it reaches the sealed run. */
gdprobe_status gdprobe_attest_gpu(gdprobe_run *run,
                                  gdprobe_gpu_attestation attestation,
                                  const char *note);

/*
 * Claim that the timings in this run came from real hardware.
 *
 * Only meaningful alongside GDPROBE_RENDERER_HARDWARE, and only admitted when
 * the operator also authorised hardware-performance evidence.
 */
gdprobe_status gdprobe_attest_performance(gdprobe_run *run, int reported, const char *note);

/*
 * Begin a frame. `label` may be NULL; if given it is slugified to the
 * lowercase identifier the contract requires, so "GBuffer Pass" is accepted
 * and stored as "gbuffer-pass" rather than rejected after the run.
 */
gdprobe_frame *gdprobe_frame_begin(gdprobe_run *run, uint32_t index, const char *label);

/*
 * Attach 8-bit RGBA pixels.
 *
 * `row_stride` is bytes per row and is NOT assumed to be width * 4: wgpu
 * aligns copy rows to 256 bytes, and reading width*4 would walk into padding
 * and record it as image data.
 *
 * You do not name the file. The path is derived, which is what keeps a
 * manifest from ever pointing outside its run directory.
 */
gdprobe_status gdprobe_attach_rgba8(gdprobe_frame *frame,
                                    gdprobe_attachment_kind kind,
                                    const char *label,
                                    const void *pixels,
                                    uint32_t width,
                                    uint32_t height,
                                    size_t row_stride);

/*
 * Attach a 32-bit object or material id buffer.
 *
 * Ids are packed into RGB the way the harness unpacks them, so the semantic
 * diff can attribute changed pixels to your objects. Id 0 means "nothing".
 */
gdprobe_status gdprobe_attach_ids(gdprobe_frame *frame,
                                  gdprobe_attachment_kind kind,
                                  const char *label,
                                  const uint32_t *ids,
                                  uint32_t width,
                                  uint32_t height,
                                  size_t row_stride);

void gdprobe_frame_end(gdprobe_frame *frame);

/*
 * Emit one telemetry sample.
 *
 * The sequence number is owned by the library and increments atomically, which
 * is what makes the harness's strictly-increasing requirement structural
 * rather than something every engine has to remember.
 *
 * `frame_index` may be -1 when the sample belongs to no particular frame; only
 * samples that name a frame can be excluded as warmup later.
 */
gdprobe_status gdprobe_emit(gdprobe_run *run,
                            const char *category,
                            const char *name,
                            double value,
                            const char *unit,
                            int32_t frame_index);

/*
 * How a number was measured. The telemetry-level analogue of the evidence
 * ceiling: a GPU timestamp query and a counter the engine incremented look
 * identical as doubles, and this is what tells them apart downstream. Say how
 * you know, not just what you know.
 *
 * gdprobe_emit and gdprobe_measure record GDPROBE_MEASURED_UNKNOWN. Prefer the
 * *_measured variants: a goal that requires a hardware measurement will refuse
 * a metric of unknown provenance.
 */
typedef enum gdprobe_measured_by {
  GDPROBE_MEASURED_UNKNOWN = 0,
  GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY,       /* vkCmdWriteTimestamp, MTLCounterSampleBuffer, wgpu timestamp writes */
  GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY, /* VK_QUERY_TYPE_PIPELINE_STATISTICS, GL_SAMPLES_PASSED */
  GDPROBE_MEASURED_DRIVER_REPORT,             /* VRAM budgets, allocator reports, pipeline creation feedback */
  GDPROBE_MEASURED_ENGINE_COUNTER,            /* a number your code incremented */
  GDPROBE_MEASURED_WALL_CLOCK                 /* a CPU clock around a submit */
} gdprobe_measured_by;

gdprobe_status gdprobe_emit_measured(gdprobe_run *run,
                                     const char *category,
                                     const char *name,
                                     double value,
                                     const char *unit,
                                     int32_t frame_index,
                                     gdprobe_measured_by measured_by);

/*
 * Record a measurement that is already aggregated -- a p99 you computed
 * yourself, say. Use "sample" for raw per-frame values.
 *
 * Getting this right matters: the harness groups by aggregation, and a p99
 * pooled with raw samples produces a median of a mixed bag.
 */
/*
 * Severity of a diagnostic message. Validation layers and debug callbacks
 * distinguish these, and so does the harness when it asks "what is new since
 * the last good run": a new error is a finding, a new info line usually not.
 */
typedef enum gdprobe_severity {
  GDPROBE_SEVERITY_INFO = 0,
  GDPROBE_SEVERITY_WARNING,
  GDPROBE_SEVERITY_ERROR
} gdprobe_severity;

/*
 * Record one diagnostic message: a validation-layer report, a GL_KHR_debug
 * callback, a shader compile warning, your own assertion.
 *
 * Route your API's debug callback here instead of (or as well as) stderr. The
 * harness groups identical messages -- handles and numbers normalised away --
 * links each group to the frames it occurred in, and diffs a run against its
 * baseline, so "a new validation error appeared in this change" is a direct
 * answer rather than a search through logs.
 *
 * `source` names the reporter ("vulkan-validation", "gl-debug", "engine").
 * `message_id` is the reporter's stable id when it has one (Vulkan's
 * pMessageIdName, a GL id), else NULL. `message` is truncated at 4000 bytes.
 * `frame_index` may be -1 for messages outside any frame, such as at setup.
 */
gdprobe_status gdprobe_diagnostic(gdprobe_run *run,
                                  const char *source,
                                  gdprobe_severity severity,
                                  const char *message_id,
                                  const char *message,
                                  int32_t frame_index);

/* Which clock a span was timed on. GPU and CPU spans never nest in each other. */
typedef enum gdprobe_clock_domain {
  GDPROBE_CLOCK_GPU = 0,
  GDPROBE_CLOCK_CPU
} gdprobe_clock_domain;

/*
 * Reserve a span id. Ids are SDK-owned and unique within the run, so a parent
 * can be named before it is recorded: reserve the frame's id, record each pass
 * with that parent as its timings resolve, then record the frame itself.
 * Returns 0 only when `run` is NULL.
 */
uint64_t gdprobe_span_reserve(gdprobe_run *run);

/*
 * Record a timed span: a frame, a pass, a stage, a scope.
 *
 * `parent_id` is 0 for a root. Times are in nanoseconds on the named clock --
 * for a GPU span, the resolved timestamp query values scaled by the device's
 * timestamp period. The harness builds the tree, computes each span's own
 * (self) time, and names the pass that grew between two runs, which is where
 * "frame_time regressed" becomes an edit. `name` is cleaned to the metric
 * identifier alphabet (spaces become `_`).
 */
gdprobe_status gdprobe_span_record(gdprobe_run *run,
                                   uint64_t span_id,
                                   uint64_t parent_id,
                                   const char *name,
                                   int32_t frame_index,
                                   uint64_t start_ns,
                                   uint64_t duration_ns,
                                   gdprobe_clock_domain clock,
                                   gdprobe_measured_by measured_by);

gdprobe_status gdprobe_measure(gdprobe_run *run,
                               const char *metric,
                               double value,
                               const char *unit,
                               const char *aggregation,
                               int32_t frame_index);

gdprobe_status gdprobe_measure_measured(gdprobe_run *run,
                                        const char *metric,
                                        double value,
                                        const char *unit,
                                        const char *aggregation,
                                        int32_t frame_index,
                                        gdprobe_measured_by measured_by);

/*
 * Finish the run: flush every attachment, then write capture.json last.
 *
 * The manifest is written last on purpose. A process that dies mid-capture
 * leaves no manifest at all, so the harness reports a failed run rather than
 * validating a manifest that names truncated files.
 *
 * On success `run` is freed. On failure it is NOT, so gdprobe_last_error can
 * still explain what went wrong; release it with gdprobe_run_discard.
 */
gdprobe_status gdprobe_run_end(gdprobe_run *run);

/* Release a run without writing a manifest. Use after gdprobe_run_end fails,
   or to abandon a capture deliberately. Safe with NULL. */
void gdprobe_run_discard(gdprobe_run *run);

/* ------------------------------------------------------------------ sessions
 *
 * Live sessions: the AI asks a RUNNING engine questions. Compile
 * gdprobe_session.c as well to use them (POSIX only; on other platforms
 * gdprobe_session_open reports GDPROBE_NOT_ATTACHED).
 *
 * A session is not a capture. Nothing it produces is sealed or counts as
 * evidence; it is for forming a hypothesis, which a scenario run then proves.
 * Under `game-dev session` the harness supplies a socket and a one-time token;
 * outside it, gdprobe_session_open returns NULL with GDPROBE_NOT_ATTACHED and
 * the engine runs normally.
 *
 * Call gdprobe_session_poll once per loop iteration. It never blocks: it
 * answers whatever requests have arrived and returns. Render the next frame
 * only when gdprobe_session_should_advance says so, which is how pause and
 * step work without the SDK owning your loop.
 */

typedef struct gdprobe_session gdprobe_session;

typedef struct gdprobe_session_handlers {
  /*
   * Hand over the pixels of the most recent frame as 8-bit RGBA. The pointer
   * must stay valid until this callback returns; the SDK writes the PNG before
   * returning. NULL to refuse snapshots.
   */
  gdprobe_status (*snapshot)(void *user, const unsigned char **pixels,
                             uint32_t *width, uint32_t *height, size_t *row_stride);
  /*
   * Answer a free-text question about engine state ("object 7", "camera",
   * "lights") by writing ONE JSON value into `out`, NUL-terminated, at most
   * `capacity` bytes. Answer from your scene graph: this is how the AI learns
   * why something is invisible. NULL to refuse queries.
   */
  gdprobe_status (*state_query)(void *user, const char *query, char *out, size_t capacity);
} gdprobe_session_handlers;

gdprobe_session *gdprobe_session_open(gdprobe_status *out_status);
gdprobe_status gdprobe_session_poll(gdprobe_session *session,
                                    const gdprobe_session_handlers *handlers,
                                    void *user,
                                    int32_t frame_index);
/* 1 when the engine should render its next frame: not paused, or stepping. */
int gdprobe_session_should_advance(gdprobe_session *session);
/* 1 once the harness has said goodbye or the connection dropped. */
int gdprobe_session_closed(const gdprobe_session *session);
void gdprobe_session_close(gdprobe_session *session);

#ifdef __cplusplus
}
#endif

#endif /* GDPROBE_H */
