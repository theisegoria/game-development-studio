/*
 * A windowless OpenGL engine that produces a sealed, GPU-attested capture.
 *
 * No window, no display server: a CGL context on macOS, a surfaceless EGL
 * context on Linux, and a framebuffer object as the only render target. The
 * same two objects as every other example, rendered into a colour attachment
 * and an R32UI object-id attachment, read back with glReadPixels.
 *
 * What it is honest about, because the harness will check:
 *
 *   - The GL_RENDERER string decides the renderer class. llvmpipe, softpipe,
 *     SwiftShader and Apple's software renderer are declared SOFTWARE and
 *     make no GPU attestation.
 *   - Attestation is TIMESTAMP_RESOLVED when the GL_TIMESTAMP query pair
 *     came back, else FENCE_SIGNALLED after glClientWaitSync. glFinish alone
 *     is not treated as evidence of anything.
 *   - GL_SAMPLES_PASSED is a hardware sample counter and is emitted as a
 *     pipeline-statistics measurement; with no depth test it IS the overdraw.
 *   - VRAM is vendor-extension only on GL and nothing here claims it.
 *   - GL_KHR_debug output, where the context offers it (Linux, GL 4.3+), is
 *     counted into diagnostic telemetry and printed to stderr, which the
 *     harness seals into the run.
 *
 * Build: see build.sh. Outside the harness it renders once and exits 0.
 */

#define _POSIX_C_SOURCE 200809L
#define GL_SILENCE_DEPRECATION 1

#include "../../c/gdprobe.h"

#ifdef __APPLE__
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#else
#define GL_GLEXT_PROTOTYPES 1
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define WIDTH 64
#define HEIGHT 32

static const char *VERTEX_SHADER =
  "#version 150 core\n"
  "in vec2 position;\n"
  "in uint object;\n"
  "flat out uint vObject;\n"
  "void main() { gl_Position = vec4(position, 0.0, 1.0); vObject = object; }\n";

static const char *FRAGMENT_SHADER =
  "#version 150 core\n"
  "flat in uint vObject;\n"
  "uniform float brightness;\n"
  "out vec4 color;\n"
  "out uint objectId;\n"
  "void main() {\n"
  "  color = vObject == 1u\n"
  "    ? vec4((200.0 + brightness) / 255.0, 40.0 / 255.0, 20.0 / 255.0, 1.0)\n"
  "    : vec4(20.0 / 255.0, 40.0 / 255.0, 200.0 / 255.0, 1.0);\n"
  "  objectId = vObject;\n"
  "}\n";

typedef struct { float position[2]; unsigned int object; } vertex_in;

static double nanoseconds_now(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (double) now.tv_sec * 1e9 + (double) now.tv_nsec;
}

static unsigned int debug_messages = 0;

#ifndef __APPLE__
static void GLAPIENTRY on_debug_message(GLenum source, GLenum type, GLuint id, GLenum severity,
                                        GLsizei length, const GLchar *message, const void *user) {
  (void) source; (void) type; (void) id; (void) length; (void) user;
  if (severity == GL_DEBUG_SEVERITY_NOTIFICATION) return;
  debug_messages += 1;
  fprintf(stderr, "gl debug: %s\n", message);
}
#endif

/* ------------------------------------------------------------- contexts */

#ifdef __APPLE__
static CGLContextObj context_create(void) {
  CGLPixelFormatAttribute attributes[] = {
    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute) kCGLOGLPVersion_3_2_Core,
    kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers,
    (CGLPixelFormatAttribute) 0,
  };
  CGLPixelFormatObj format = NULL;
  GLint count = 0;
  if (CGLChoosePixelFormat(attributes, &format, &count) != kCGLNoError || !format) {
    /* Fall back to whatever renderer exists, which may be the software one;
       the GL_RENDERER string will say so and the run is declared accordingly. */
    CGLPixelFormatAttribute fallback[] = {
      kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute) kCGLOGLPVersion_3_2_Core, (CGLPixelFormatAttribute) 0,
    };
    if (CGLChoosePixelFormat(fallback, &format, &count) != kCGLNoError || !format) return NULL;
  }
  CGLContextObj context = NULL;
  CGLError created = CGLCreateContext(format, NULL, &context);
  CGLDestroyPixelFormat(format);
  if (created != kCGLNoError || !context) return NULL;
  if (CGLSetCurrentContext(context) != kCGLNoError) { CGLDestroyContext(context); return NULL; }
  return context;
}
static void context_destroy(CGLContextObj context) {
  CGLSetCurrentContext(NULL);
  CGLDestroyContext(context);
}
#else
typedef struct { EGLDisplay display; EGLContext context; } egl_context;
static int context_create(egl_context *out) {
  EGLDisplay display = EGL_NO_DISPLAY;
  /* Surfaceless first: no display server at all. */
  PFNEGLGETPLATFORMDISPLAYEXTPROC get_platform_display =
    (PFNEGLGETPLATFORMDISPLAYEXTPROC) eglGetProcAddress("eglGetPlatformDisplayEXT");
  const char *client_extensions = eglQueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS);
  if (get_platform_display && client_extensions && strstr(client_extensions, "EGL_MESA_platform_surfaceless")) {
    display = get_platform_display(0x31DD /* EGL_PLATFORM_SURFACELESS_MESA */, EGL_DEFAULT_DISPLAY, NULL);
  }
  if (display == EGL_NO_DISPLAY) display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if (display == EGL_NO_DISPLAY || !eglInitialize(display, NULL, NULL)) return 0;
  if (!eglBindAPI(EGL_OPENGL_API)) return 0;
  EGLint config_attributes[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE };
  EGLConfig config;
  EGLint count = 0;
  if (!eglChooseConfig(display, config_attributes, &config, 1, &count) || count == 0) return 0;
  EGLint context_attributes[] = {
    EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2,
    EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE,
  };
  EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, context_attributes);
  if (context == EGL_NO_CONTEXT) return 0;
  if (!eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) return 0;
  out->display = display;
  out->context = context;
  return 1;
}
static void context_destroy(egl_context *context) {
  eglMakeCurrent(context->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroyContext(context->display, context->context);
  eglTerminate(context->display);
}
#endif

static GLuint compile(GLenum kind, const char *source) {
  GLuint shader = glCreateShader(kind);
  glShaderSource(shader, 1, &source, NULL);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048];
    glGetShaderInfoLog(shader, sizeof log, NULL, log);
    fprintf(stderr, "shader compile failed: %s\n", log);
    return 0;
  }
  return shader;
}

static int is_software_renderer(const char *renderer) {
  static const char *names[] = { "llvmpipe", "softpipe", "SwiftShader", "Software Renderer", "Mesa Offscreen", NULL };
  for (int i = 0; names[i]; i += 1) if (renderer && strstr(renderer, names[i])) return 1;
  return 0;
}

static int has_gl_extension(const char *name) {
  GLint count = 0;
  glGetIntegerv(GL_NUM_EXTENSIONS, &count);
  for (GLint i = 0; i < count; i += 1) {
    const char *extension = (const char *) glGetStringi(GL_EXTENSIONS, (GLuint) i);
    if (extension && strcmp(extension, name) == 0) return 1;
  }
  return 0;
}

/* glReadPixels hands rows back bottom-up; every other example is top-down. */
static void flip_rows(unsigned char *pixels, size_t row_bytes, unsigned int rows) {
  unsigned char *scratch = malloc(row_bytes);
  if (!scratch) return;
  for (unsigned int y = 0; y < rows / 2; y += 1) {
    unsigned char *top = pixels + (size_t) y * row_bytes;
    unsigned char *bottom = pixels + (size_t) (rows - 1 - y) * row_bytes;
    memcpy(scratch, top, row_bytes);
    memcpy(top, bottom, row_bytes);
    memcpy(bottom, scratch, row_bytes);
  }
  free(scratch);
}

int main(int argc, char **argv) {
  float brightness = argc > 1 ? (float) atoi(argv[1]) : 0.0f;

  gdprobe_status status;
  gdprobe_run *run = gdprobe_run_begin(&status);
  if (!run && status != GDPROBE_NOT_ATTACHED) {
    fprintf(stderr, "probe failed to start: %d\n", (int) status);
    return 1;
  }

#ifdef __APPLE__
  CGLContextObj context = context_create();
  if (!context) { fprintf(stderr, "no OpenGL context\n"); return 1; }
#else
  egl_context context;
  if (!context_create(&context)) { fprintf(stderr, "no surfaceless EGL context\n"); return 1; }
#endif

  const char *renderer = (const char *) glGetString(GL_RENDERER);
  const char *version = (const char *) glGetString(GL_VERSION);
  int software = is_software_renderer(renderer);
  int timer_queries = has_gl_extension("GL_ARB_timer_query");
#ifdef __APPLE__
  /* macOS ships GL 4.1 core, which includes timer queries without listing the ARB extension. */
  timer_queries = 1;
#endif
  if (run) {
    gdprobe_declare_backend(run, GDPROBE_BACKEND_OPENGL, renderer ? renderer : "unknown", version ? version : "unknown",
                            software ? GDPROBE_RENDERER_SOFTWARE : GDPROBE_RENDERER_HARDWARE);
  }

#ifndef __APPLE__
  if (has_gl_extension("GL_KHR_debug")) {
    glEnable(GL_DEBUG_OUTPUT);
    glEnable(GL_DEBUG_OUTPUT_SYNCHRONOUS);
    glDebugMessageCallback(on_debug_message, NULL);
  }
#endif

  /* ------------------------------------------------------ render targets */
  GLuint textures[2];
  glGenTextures(2, textures);
  glBindTexture(GL_TEXTURE_2D, textures[0]);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, WIDTH, HEIGHT, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
  glBindTexture(GL_TEXTURE_2D, textures[1]);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_R32UI, WIDTH, HEIGHT, 0, GL_RED_INTEGER, GL_UNSIGNED_INT, NULL);
  GLuint framebuffer;
  glGenFramebuffers(1, &framebuffer);
  glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textures[0], 0);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT1, GL_TEXTURE_2D, textures[1], 0);
  GLenum draw_buffers[2] = { GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1 };
  glDrawBuffers(2, draw_buffers);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    fprintf(stderr, "framebuffer incomplete\n");
    return 1;
  }

  /* ------------------------------------------------------------ pipeline */
  double compile_start = nanoseconds_now();
  GLuint vertex_shader = compile(GL_VERTEX_SHADER, VERTEX_SHADER);
  GLuint fragment_shader = compile(GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex_shader || !fragment_shader) return 1;
  GLuint program = glCreateProgram();
  glAttachShader(program, vertex_shader);
  glAttachShader(program, fragment_shader);
  glBindAttribLocation(program, 0, "position");
  glBindAttribLocation(program, 1, "object");
  glBindFragDataLocation(program, 0, "color");
  glBindFragDataLocation(program, 1, "objectId");
  glLinkProgram(program);
  GLint linked = 0;
  glGetProgramiv(program, GL_LINK_STATUS, &linked);
  if (!linked) { fprintf(stderr, "program link failed\n"); return 1; }
  double compile_ns = nanoseconds_now() - compile_start;

  vertex_in vertices[12] = {
    {{-1, -1}, 1}, {{0, -1}, 1}, {{-1, 1}, 1}, {{0, -1}, 1}, {{0, 1}, 1}, {{-1, 1}, 1},
    {{0, -1}, 2}, {{1, -1}, 2}, {{0, 1}, 2}, {{1, -1}, 2}, {{1, 1}, 2}, {{0, 1}, 2},
  };
  GLuint vao, vbo;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, sizeof vertices, vertices, GL_STATIC_DRAW);
  /* The stride is the C struct's, stated explicitly. */
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(vertex_in), (const void *) 0);
  glEnableVertexAttribArray(1);
  glVertexAttribIPointer(1, 1, GL_UNSIGNED_INT, sizeof(vertex_in), (const void *) 8);

  /* ------------------------------------------------------------- queries */
  GLuint queries[3] = { 0, 0, 0 }; /* timestamp start, timestamp end, samples passed */
  glGenQueries(3, queries);

  /* ---------------------------------------------------------------- draw */
  glViewport(0, 0, WIDTH, HEIGHT);
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_BLEND);
  glUseProgram(program);
  glUniform1f(glGetUniformLocation(program, "brightness"), brightness);
  const GLfloat clear_color[4] = { 0, 0, 0, 1 };
  const GLuint clear_id[4] = { 0, 0, 0, 0 };
  glClearBufferfv(GL_COLOR, 0, clear_color);
  glClearBufferuiv(GL_COLOR, 1, clear_id);

  double cpu_start = nanoseconds_now();
  if (timer_queries) glQueryCounter(queries[0], GL_TIMESTAMP);
  glBeginQuery(GL_SAMPLES_PASSED, queries[2]);
  glDrawArrays(GL_TRIANGLES, 0, 12);
  glEndQuery(GL_SAMPLES_PASSED);
  if (timer_queries) glQueryCounter(queries[1], GL_TIMESTAMP);
  GLsync fence = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
  glFlush();
  GLenum waited = glClientWaitSync(fence, GL_SYNC_FLUSH_COMMANDS_BIT, 5000000000ull);
  double cpu_end = nanoseconds_now();
  int fence_signalled = waited == GL_ALREADY_SIGNALED || waited == GL_CONDITION_SATISFIED;
  glDeleteSync(fence);

  double pass_ns = -1;
  if (timer_queries) {
    GLuint64 start = 0, end = 0;
    GLint available = 0;
    glGetQueryObjectiv(queries[1], GL_QUERY_RESULT_AVAILABLE, &available);
    if (available) {
      glGetQueryObjectui64v(queries[0], GL_QUERY_RESULT, &start);
      glGetQueryObjectui64v(queries[1], GL_QUERY_RESULT, &end);
      if (end >= start && end != 0) pass_ns = (double) (end - start);
    }
  }
  GLuint samples_passed = 0;
  glGetQueryObjectuiv(queries[2], GL_QUERY_RESULT, &samples_passed);

  /* ------------------------------------------------------------ readback */
  static unsigned char color_pixels[WIDTH * HEIGHT * 4];
  static unsigned int id_pixels[WIDTH * HEIGHT];
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  glReadPixels(0, 0, WIDTH, HEIGHT, GL_RGBA, GL_UNSIGNED_BYTE, color_pixels);
  glReadBuffer(GL_COLOR_ATTACHMENT1);
  glReadPixels(0, 0, WIDTH, HEIGHT, GL_RED_INTEGER, GL_UNSIGNED_INT, id_pixels);
  flip_rows(color_pixels, WIDTH * 4, HEIGHT);
  flip_rows((unsigned char *) id_pixels, WIDTH * 4, HEIGHT);
  GLenum gl_error = glGetError();

  if (!run) {
    printf("not attached to the harness; rendered one frame on %s\n", renderer ? renderer : "unknown");
#ifdef __APPLE__
    context_destroy(context);
#else
    context_destroy(&context);
#endif
    return gl_error == GL_NO_ERROR ? 0 : 1;
  }

  if (!software) {
    gdprobe_status attested = pass_ns >= 0
      ? gdprobe_attest_gpu(run, GDPROBE_GPU_TIMESTAMP_RESOLVED, "GL_TIMESTAMP query pair available after fence wait")
      : fence_signalled
        ? gdprobe_attest_gpu(run, GDPROBE_GPU_FENCE_SIGNALLED, "glClientWaitSync signalled; no timer query")
        : GDPROBE_ERR_STATE;
    if (attested != GDPROBE_OK) {
      fprintf(stderr, "no attestation possible: %s\n", gdprobe_last_error(run));
      gdprobe_run_discard(run);
      return 1;
    }
    gdprobe_attest_performance(run, 1, "timings below name what measured them");
  }

  gdprobe_frame *frame = gdprobe_frame_begin(run, 0, "Main View");
  if (!frame
      || gdprobe_attach_rgba8(frame, GDPROBE_KIND_COLOR, NULL, color_pixels, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK
      || gdprobe_attach_ids(frame, GDPROBE_KIND_OBJECT_ID, NULL, id_pixels, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK) {
    fprintf(stderr, "attach failed: %s\n", gdprobe_last_error(run));
    gdprobe_run_discard(run);
    return 1;
  }
  gdprobe_frame_end(frame);

  if (pass_ns >= 0) {
    gdprobe_emit_measured(run, "render", "pass.main.gpu_duration_ns", pass_ns, "ns", 0, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
  }
  /* With no depth test every fragment passes, so samples per pixel is the overdraw. */
  gdprobe_emit_measured(run, "render", "pipeline_statistics.samples_passed", (double) samples_passed, "count", 0,
                        GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY);
  gdprobe_emit_measured(run, "render", "overdraw.fragments_per_pixel", (double) samples_passed / (WIDTH * HEIGHT), "ratio", 0,
                        GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY);
  gdprobe_emit_measured(run, "performance", "frame_time", (cpu_end - cpu_start) / 1e6, "ms", 0, GDPROBE_MEASURED_WALL_CLOCK);
  gdprobe_emit_measured(run, "performance", "pipeline_creation_ms", compile_ns / 1e6, "ms", -1, GDPROBE_MEASURED_WALL_CLOCK);
  gdprobe_emit_measured(run, "diagnostic", "opengl.debug_messages", (double) debug_messages, "count", -1, GDPROBE_MEASURED_ENGINE_COUNTER);
  gdprobe_emit_measured(run, "diagnostic", "opengl.errors", gl_error == GL_NO_ERROR ? 0.0 : 1.0, "count", -1, GDPROBE_MEASURED_ENGINE_COUNTER);
  gdprobe_measure_measured(run, "render.draw_calls", 1.0, "count", "sample", 0, GDPROBE_MEASURED_ENGINE_COUNTER);

  status = gdprobe_run_end(run);
  if (status != GDPROBE_OK) {
    fprintf(stderr, "probe failed to finish: %s\n", gdprobe_last_error(run));
    gdprobe_run_discard(run);
    return 1;
  }

  glDeleteQueries(3, queries);
  glDeleteBuffers(1, &vbo);
  glDeleteVertexArrays(1, &vao);
  glDeleteProgram(program);
  glDeleteShader(vertex_shader);
  glDeleteShader(fragment_shader);
  glDeleteFramebuffers(1, &framebuffer);
  glDeleteTextures(2, textures);
#ifdef __APPLE__
  context_destroy(context);
#else
  context_destroy(&context);
#endif
  return 0;
}
