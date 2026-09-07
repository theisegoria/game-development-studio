/*
 * A windowless Metal engine that produces a sealed, GPU-attested capture.
 *
 * Everything the minimal example does on the CPU happens here on the GPU:
 * two triangles rendered offscreen into a colour target and an object-id
 * target, read back through a blit into shared buffers, and handed to the
 * probe SDK with an attestation that says HOW the engine knows the GPU ran.
 *
 * What this example is honest about, because the harness will check:
 *
 *   - The attestation is COMMANDBUFFER_COMPLETED, taken after
 *     waitUntilCompleted returned with MTLCommandBufferStatusCompleted. Not
 *     "we submitted it"; that proves nothing.
 *   - Per-pass GPU time comes from a counter sample buffer at stage boundaries
 *     when the device supports one, and is emitted as gpu_timestamp_query.
 *     Metal exposes stage-boundary sampling on every device but not
 *     draw-boundary sampling on Apple silicon, so this is what "per-pass
 *     GPU time" means on Metal: the whole pass, not a draw inside it.
 *   - The command buffer's GPUStartTime/GPUEndTime is a driver report, and is
 *     emitted as driver_report, not as a timestamp query.
 *   - The CPU clock around commit-to-completion is a wall clock, and says so.
 *   - Pipeline statistics do not exist on Metal; nothing here claims them.
 *
 * Build (no metallib step: the shader is compiled from source at runtime):
 *
 *   clang -fobjc-arc -std=c99 -Wall -Wextra -Werror -x objective-c \
 *     -framework Metal -framework Foundation \
 *     ../../c/gdprobe.c main.m -o gdprobe-metal
 *
 * Run outside the harness and it renders once and exits 0, like the minimal
 * example. Under `game-dev scenario run`, it writes the capture.
 */

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

#include "../../c/gdprobe.h"

#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>

#define WIDTH 64
#define HEIGHT 32

static NSString *const kShader = @""
"#include <metal_stdlib>\n"
"using namespace metal;\n"
"// packed: a bare float2 aligns to 8 bytes and pads this struct to 16,\n"
"// which silently misreads a 12-byte C vertex stream at the wrong stride.\n"
"struct VertexIn { packed_float2 position; uint object; };\n"
"struct VertexOut { float4 position [[position]]; uint object [[flat]]; };\n"
"struct Fragment { float4 color [[color(0)]]; uint object [[color(1)]]; };\n"
"vertex VertexOut vs(uint id [[vertex_id]], constant VertexIn *vertices [[buffer(0)]]) {\n"
"  VertexOut out;\n"
"  out.position = float4(vertices[id].position, 0.0, 1.0);\n"
"  out.object = vertices[id].object;\n"
"  return out;\n"
"}\n"
"fragment Fragment fs(VertexOut in [[stage_in]], constant float &brightness [[buffer(0)]]) {\n"
"  Fragment out;\n"
"  // Object 1 red (shifted by brightness), object 2 blue. Flat, so the\n"
"  // output is deterministic on a given GPU: no interpolation, no MSAA.\n"
"  out.color = in.object == 1u ? float4((200.0 + brightness) / 255.0, 40.0 / 255.0, 20.0 / 255.0, 1.0)\n"
"                              : float4(20.0 / 255.0, 40.0 / 255.0, 200.0 / 255.0, 1.0);\n"
"  out.object = in.object;\n"
"  return out;\n"
"}\n";

typedef struct { float position[2]; uint32_t object; } vertex_in;

static double nanoseconds_now(void) {
  static mach_timebase_info_data_t timebase;
  if (timebase.denom == 0) mach_timebase_info(&timebase);
  return (double) mach_absolute_time() * timebase.numer / timebase.denom;
}

static int fail(gdprobe_run *run, const char *what) {
  fprintf(stderr, "%s: %s\n", what, run ? gdprobe_last_error(run) : "");
  if (run) gdprobe_run_discard(run);
  return 1;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    float brightness = argc > 1 ? (float) atoi(argv[1]) : 0.0f;

    gdprobe_status status;
    gdprobe_run *run = gdprobe_run_begin(&status);
    if (!run && status != GDPROBE_NOT_ATTACHED) {
      fprintf(stderr, "probe failed to start: %d\n", (int) status);
      return 1;
    }

    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!device) {
      fprintf(stderr, "no Metal device\n");
      if (run) gdprobe_run_discard(run);
      return 1;
    }
    if (run) {
      /* Metal has no software device on macOS; the paravirtual GPU on a
         hosted runner is still hardware to the API, and reported as such
         with its name so a reader can tell. */
      gdprobe_declare_backend(run, GDPROBE_BACKEND_METAL,
                              device.name.UTF8String, "system", GDPROBE_RENDERER_HARDWARE);
    }

    NSError *error = nil;
    id<MTLLibrary> library = [device newLibraryWithSource:kShader options:nil error:&error];
    if (!library) {
      fprintf(stderr, "shader compile failed: %s\n", error.localizedDescription.UTF8String);
      if (run) gdprobe_run_discard(run);
      return 1;
    }
    MTLRenderPipelineDescriptor *pipelineDescriptor = [MTLRenderPipelineDescriptor new];
    pipelineDescriptor.vertexFunction = [library newFunctionWithName:@"vs"];
    pipelineDescriptor.fragmentFunction = [library newFunctionWithName:@"fs"];
    pipelineDescriptor.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA8Unorm;
    pipelineDescriptor.colorAttachments[1].pixelFormat = MTLPixelFormatR32Uint;
    id<MTLRenderPipelineState> pipeline = [device newRenderPipelineStateWithDescriptor:pipelineDescriptor error:&error];
    if (!pipeline) {
      fprintf(stderr, "pipeline failed: %s\n", error.localizedDescription.UTF8String);
      if (run) gdprobe_run_discard(run);
      return 1;
    }

    MTLTextureDescriptor *colorDescriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm width:WIDTH height:HEIGHT mipmapped:NO];
    colorDescriptor.usage = MTLTextureUsageRenderTarget;
    colorDescriptor.storageMode = MTLStorageModePrivate;
    id<MTLTexture> color = [device newTextureWithDescriptor:colorDescriptor];
    MTLTextureDescriptor *idDescriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:MTLPixelFormatR32Uint width:WIDTH height:HEIGHT mipmapped:NO];
    idDescriptor.usage = MTLTextureUsageRenderTarget;
    idDescriptor.storageMode = MTLStorageModePrivate;
    id<MTLTexture> objectIds = [device newTextureWithDescriptor:idDescriptor];

    /* Object 1 fills the left half, object 2 the right, as two triangles each. */
    vertex_in vertices[12] = {
      {{-1, -1}, 1}, {{0, -1}, 1}, {{-1, 1}, 1}, {{0, -1}, 1}, {{0, 1}, 1}, {{-1, 1}, 1},
      {{0, -1}, 2}, {{1, -1}, 2}, {{0, 1}, 2}, {{1, -1}, 2}, {{1, 1}, 2}, {{0, 1}, 2},
    };
    id<MTLBuffer> vertexBuffer = [device newBufferWithBytes:vertices length:sizeof vertices options:MTLResourceStorageModeShared];
    id<MTLBuffer> colorReadback = [device newBufferWithLength:WIDTH * HEIGHT * 4 options:MTLResourceStorageModeShared];
    id<MTLBuffer> idReadback = [device newBufferWithLength:WIDTH * HEIGHT * 4 options:MTLResourceStorageModeShared];

    /* Stage-boundary GPU timestamps, when the device offers them. */
    id<MTLCounterSampleBuffer> samples = nil;
    if ([device supportsCounterSampling:MTLCounterSamplingPointAtStageBoundary]) {
      for (id<MTLCounterSet> set in device.counterSets) {
        if ([set.name isEqualToString:MTLCommonCounterSetTimestamp]) {
          MTLCounterSampleBufferDescriptor *descriptor = [MTLCounterSampleBufferDescriptor new];
          descriptor.counterSet = set;
          descriptor.sampleCount = 2;
          descriptor.storageMode = MTLStorageModeShared;
          samples = [device newCounterSampleBufferWithDescriptor:descriptor error:&error];
          break;
        }
      }
    }

    id<MTLCommandQueue> queue = [device newCommandQueue];
    id<MTLCommandBuffer> commands = [queue commandBuffer];

    MTLRenderPassDescriptor *pass = [MTLRenderPassDescriptor renderPassDescriptor];
    pass.colorAttachments[0].texture = color;
    pass.colorAttachments[0].loadAction = MTLLoadActionClear;
    pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1);
    pass.colorAttachments[0].storeAction = MTLStoreActionStore;
    pass.colorAttachments[1].texture = objectIds;
    pass.colorAttachments[1].loadAction = MTLLoadActionClear;
    pass.colorAttachments[1].clearColor = MTLClearColorMake(0, 0, 0, 0);
    pass.colorAttachments[1].storeAction = MTLStoreActionStore;
    if (samples) {
      pass.sampleBufferAttachments[0].sampleBuffer = samples;
      pass.sampleBufferAttachments[0].startOfVertexSampleIndex = 0;
      pass.sampleBufferAttachments[0].endOfVertexSampleIndex = MTLCounterDontSample;
      pass.sampleBufferAttachments[0].startOfFragmentSampleIndex = MTLCounterDontSample;
      pass.sampleBufferAttachments[0].endOfFragmentSampleIndex = 1;
    }

    id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
    [encoder setRenderPipelineState:pipeline];
    [encoder setVertexBuffer:vertexBuffer offset:0 atIndex:0];
    [encoder setFragmentBytes:&brightness length:sizeof brightness atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:12];
    [encoder endEncoding];

    id<MTLBlitCommandEncoder> blit = [commands blitCommandEncoder];
    [blit copyFromTexture:color sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0, 0, 0)
               sourceSize:MTLSizeMake(WIDTH, HEIGHT, 1) toBuffer:colorReadback destinationOffset:0
      destinationBytesPerRow:WIDTH * 4 destinationBytesPerImage:WIDTH * HEIGHT * 4];
    [blit copyFromTexture:objectIds sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0, 0, 0)
               sourceSize:MTLSizeMake(WIDTH, HEIGHT, 1) toBuffer:idReadback destinationOffset:0
      destinationBytesPerRow:WIDTH * 4 destinationBytesPerImage:WIDTH * HEIGHT * 4];
    [blit endEncoding];

    double cpuStart = nanoseconds_now();
    [commands commit];
    [commands waitUntilCompleted];
    double cpuEnd = nanoseconds_now();

    if (commands.status != MTLCommandBufferStatusCompleted) {
      fprintf(stderr, "command buffer did not complete: %s\n", commands.error.localizedDescription.UTF8String);
      if (run) gdprobe_run_discard(run);
      return 1;
    }

    if (!run) {
      puts("not attached to the harness; rendered one frame on the GPU");
      return 0;
    }

    /* Resolve the pass timestamps first, because they decide the strength
       of the attestation: a resolved GPU timestamp pair identifies the pass
       that completed, where a command buffer status only says something did.
       A zero timestamp means the counter was not sampled and is not reported. */
    double passDurationNs = -1;
    if (samples) {
      NSData *resolved = [samples resolveCounterRange:NSMakeRange(0, 2)];
      if (resolved.length >= sizeof(MTLCounterResultTimestamp) * 2) {
        const MTLCounterResultTimestamp *stamps = resolved.bytes;
        if (stamps[0].timestamp != 0 && stamps[1].timestamp != 0 && stamps[1].timestamp >= stamps[0].timestamp) {
          passDurationNs = (double) (stamps[1].timestamp - stamps[0].timestamp);
        }
      }
    }

    /* Now, and only now, the engine knows the GPU ran. The enum says HOW. */
    gdprobe_status attested = passDurationNs >= 0
      ? gdprobe_attest_gpu(run, GDPROBE_GPU_TIMESTAMP_RESOLVED,
                           "stage-boundary counter samples resolved for the pass; command buffer status Completed")
      : gdprobe_attest_gpu(run, GDPROBE_GPU_COMMANDBUFFER_COMPLETED,
                           "MTLCommandBuffer.status == Completed after waitUntilCompleted; no counter sampling");
    if (attested != GDPROBE_OK) return fail(run, "attestation refused");
    gdprobe_attest_performance(run, 1, "timings below name what measured them");

    gdprobe_frame *frame = gdprobe_frame_begin(run, 0, "Main View");
    if (!frame) return fail(run, "frame");
    if (gdprobe_attach_rgba8(frame, GDPROBE_KIND_COLOR, NULL, colorReadback.contents, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK
        || gdprobe_attach_ids(frame, GDPROBE_KIND_OBJECT_ID, NULL, idReadback.contents, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK) {
      return fail(run, "attach");
    }
    gdprobe_frame_end(frame);

    /* Three timings for one pass, each saying what measured it. */
    if (passDurationNs >= 0) {
      gdprobe_emit_measured(run, "render", "pass.main.gpu_duration_ns", passDurationNs, "ns", 0,
                            GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    }
    gdprobe_emit_measured(run, "render", "commandbuffer.gpu_duration_ns",
                          (commands.GPUEndTime - commands.GPUStartTime) * 1e9, "ns", 0,
                          GDPROBE_MEASURED_DRIVER_REPORT);
    gdprobe_emit_measured(run, "performance", "frame_time", (cpuEnd - cpuStart) / 1e6, "ms", 0,
                          GDPROBE_MEASURED_WALL_CLOCK);
    gdprobe_measure_measured(run, "render.draw_calls", 1.0, "count", "sample", 0, GDPROBE_MEASURED_ENGINE_COUNTER);

    status = gdprobe_run_end(run);
    if (status != GDPROBE_OK) return fail(run, "probe failed to finish");
    return 0;
  }
}
