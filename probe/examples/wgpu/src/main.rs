//! A windowless wgpu engine that produces a sealed, GPU-attested capture.
//!
//! The same two objects as every other example, rendered offscreen into an
//! RGBA8 colour target and an R32Uint object-id target, read back through a
//! buffer copy, and handed to the C probe SDK across a small FFI binding.
//!
//! What it is honest about, because the harness will check:
//!
//!   - `DeviceType::Cpu` (lavapipe, SwiftShader through wgpu) is declared a
//!     software renderer and makes no GPU attestation.
//!   - Attestation is TIMESTAMP_RESOLVED when the pass's timestamp writes
//!     resolved and mapped back, else FENCE_SIGNALLED after the readback map
//!     completed -- which on wgpu is what "the queue finished" looks like.
//!   - Per-pass GPU time uses `Features::TIMESTAMP_QUERY` and the pass's
//!     `timestamp_writes`, scaled by `Queue::get_timestamp_period`. Pipeline
//!     statistics are requested only when the adapter offers the feature
//!     (Vulkan and DX12 backends); nothing is claimed elsewhere.
//!   - wgpu exposes no stable VRAM accounting; nothing here claims it.
//!   - Readback rows are padded to 256 bytes. The SDK takes a row stride for
//!     exactly this reason; do not hand it `width * 4`.
//!
//! Build and run: `cargo run --release -- 0`. Outside the harness it renders
//! once and exits 0.

mod gdprobe;

use gdprobe::c;
use std::time::Instant;

const WIDTH: u32 = 64;
const HEIGHT: u32 = 32;

const SHADER: &str = r#"
struct VertexIn { @location(0) position: vec2<f32>, @location(1) object: u32 }
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) @interpolate(flat) object: u32 }
struct FragmentOut { @location(0) color: vec4<f32>, @location(1) object: u32 }
struct Push { brightness: f32 }
@group(0) @binding(0) var<uniform> push: Push;

@vertex fn vs(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(input.position, 0.0, 1.0);
  out.object = input.object;
  return out;
}

@fragment fn fs(input: VertexOut) -> FragmentOut {
  var out: FragmentOut;
  // Object 1 red (shifted by brightness), object 2 blue. Flat and unlit, so
  // the output is deterministic on a given device: no interpolation, no MSAA.
  if (input.object == 1u) {
    out.color = vec4<f32>((200.0 + push.brightness) / 255.0, 40.0 / 255.0, 20.0 / 255.0, 1.0);
  } else {
    out.color = vec4<f32>(20.0 / 255.0, 40.0 / 255.0, 200.0 / 255.0, 1.0);
  }
  out.object = input.object;
  return out;
}
"#;

#[repr(C)]
#[derive(Clone, Copy)]
struct Vertex { position: [f32; 2], object: u32 }

fn padded_row(bytes: u32) -> u32 {
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    bytes.div_ceil(align) * align
}

fn main() {
    let brightness: f32 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0.0);

    let mut status = 0;
    // SAFETY: plain FFI into the SDK; a NULL run with status NOT_ATTACHED is documented.
    let run = unsafe { gdprobe::gdprobe_run_begin(&mut status) };
    if run.is_null() && status != gdprobe::NOT_ATTACHED {
        eprintln!("probe failed to start: {status}");
        std::process::exit(1);
    }

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .unwrap_or_else(|| { eprintln!("no wgpu adapter"); std::process::exit(1) });
    let info = adapter.get_info();
    let software = info.device_type == wgpu::DeviceType::Cpu;

    let available = adapter.features();
    let mut wanted = wgpu::Features::empty();
    let timestamps = available.contains(wgpu::Features::TIMESTAMP_QUERY);
    let statistics = available.contains(wgpu::Features::PIPELINE_STATISTICS_QUERY);
    if timestamps { wanted |= wgpu::Features::TIMESTAMP_QUERY; }
    if statistics { wanted |= wgpu::Features::PIPELINE_STATISTICS_QUERY; }
    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor { label: Some("gdprobe"), required_features: wanted, ..Default::default() },
        None,
    ))
    .unwrap_or_else(|e| { eprintln!("no wgpu device: {e}"); std::process::exit(1) });

    if !run.is_null() {
        let device_name = c(&info.name);
        let driver = c(&format!("{} {} ({:?})", info.driver, info.driver_info, info.backend));
        // SAFETY: strings outlive the call; the SDK copies them.
        unsafe {
            gdprobe::gdprobe_declare_backend(run, gdprobe::BACKEND_WEBGPU, device_name.as_ptr(), driver.as_ptr(),
                if software { gdprobe::RENDERER_SOFTWARE } else { gdprobe::RENDERER_HARDWARE });
        }
    }

    // ---------------------------------------------------------------- pipeline
    let compile_start = Instant::now();
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("scene"), source: wgpu::ShaderSource::Wgsl(SHADER.into()),
    });
    let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
            count: None,
        }],
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None, bind_group_layouts: &[&bind_layout], push_constant_ranges: &[],
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("scene"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader, entry_point: Some("vs"), compilation_options: Default::default(),
            buffers: &[wgpu::VertexBufferLayout {
                // The stride is the Rust struct's, stated explicitly.
                array_stride: std::mem::size_of::<Vertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &[
                    wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0, shader_location: 0 },
                    wgpu::VertexAttribute { format: wgpu::VertexFormat::Uint32, offset: 8, shader_location: 1 },
                ],
            }],
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader, entry_point: Some("fs"), compilation_options: Default::default(),
            targets: &[
                Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::Rgba8Unorm, blend: None, write_mask: wgpu::ColorWrites::ALL }),
                Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::R32Uint, blend: None, write_mask: wgpu::ColorWrites::ALL }),
            ],
        }),
        primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    });
    let compile_ms = compile_start.elapsed().as_secs_f64() * 1e3;

    // ----------------------------------------------------------------- buffers
    let vertices = [
        Vertex { position: [-1.0, -1.0], object: 1 }, Vertex { position: [0.0, -1.0], object: 1 }, Vertex { position: [-1.0, 1.0], object: 1 },
        Vertex { position: [0.0, -1.0], object: 1 }, Vertex { position: [0.0, 1.0], object: 1 }, Vertex { position: [-1.0, 1.0], object: 1 },
        Vertex { position: [0.0, -1.0], object: 2 }, Vertex { position: [1.0, -1.0], object: 2 }, Vertex { position: [0.0, 1.0], object: 2 },
        Vertex { position: [1.0, -1.0], object: 2 }, Vertex { position: [1.0, 1.0], object: 2 }, Vertex { position: [0.0, 1.0], object: 2 },
    ];
    // SAFETY: Vertex is repr(C) plain data with no padding at these sizes (8 + 4).
    let vertex_bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(vertices.as_ptr() as *const u8, std::mem::size_of_val(&vertices))
    };
    let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("vertices"), size: vertex_bytes.len() as u64, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
    });
    queue.write_buffer(&vertex_buffer, 0, vertex_bytes);
    let uniform = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("push"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
    });
    let mut push = [0u8; 16];
    push[..4].copy_from_slice(&brightness.to_le_bytes());
    queue.write_buffer(&uniform, 0, &push);
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None, layout: &bind_layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }],
    });

    let make_target = |label: &str, format: wgpu::TextureFormat| device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[],
    });
    let color = make_target("color", wgpu::TextureFormat::Rgba8Unorm);
    let object_ids = make_target("object_id", wgpu::TextureFormat::R32Uint);
    let color_view = color.create_view(&Default::default());
    let id_view = object_ids.create_view(&Default::default());

    // Readback rows are padded to COPY_BYTES_PER_ROW_ALIGNMENT. That padded
    // width is the row stride the SDK is told about, not WIDTH * 4.
    let row_stride = padded_row(WIDTH * 4);
    let readback_size = (row_stride * HEIGHT) as u64;
    let make_readback = |label: &str| device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label), size: readback_size, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false,
    });
    let color_readback = make_readback("color readback");
    let id_readback = make_readback("id readback");

    // ----------------------------------------------------------------- queries
    let timestamp_set = timestamps.then(|| device.create_query_set(&wgpu::QuerySetDescriptor {
        label: Some("timestamps"), ty: wgpu::QueryType::Timestamp, count: 2,
    }));
    let statistics_set = statistics.then(|| device.create_query_set(&wgpu::QuerySetDescriptor {
        label: Some("statistics"),
        ty: wgpu::QueryType::PipelineStatistics(wgpu::PipelineStatisticsTypes::FRAGMENT_SHADER_INVOCATIONS | wgpu::PipelineStatisticsTypes::CLIPPER_PRIMITIVES_OUT),
        count: 1,
    }));
    let query_resolve = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("query resolve"), size: 256, usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false,
    });
    let query_readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("query readback"), size: 256, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false,
    });

    // ------------------------------------------------------------------ encode
    let mut encoder = device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("main"),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: &color_view, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &id_view, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                }),
            ],
            depth_stencil_attachment: None,
            timestamp_writes: timestamp_set.as_ref().map(|set| wgpu::RenderPassTimestampWrites {
                query_set: set, beginning_of_pass_write_index: Some(0), end_of_pass_write_index: Some(1),
            }),
            occlusion_query_set: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_vertex_buffer(0, vertex_buffer.slice(..));
        if let Some(set) = &statistics_set { pass.begin_pipeline_statistics_query(set, 0); }
        pass.draw(0..12, 0..1);
        if statistics_set.is_some() { pass.end_pipeline_statistics_query(); }
    }
    if let Some(set) = &timestamp_set { encoder.resolve_query_set(set, 0..2, &query_resolve, 0); }
    if let Some(set) = &statistics_set { encoder.resolve_query_set(set, 0..1, &query_resolve, 64); }
    encoder.copy_buffer_to_buffer(&query_resolve, 0, &query_readback, 0, 256);
    for (texture, buffer) in [(&color, &color_readback), (&object_ids, &id_readback)] {
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row_stride), rows_per_image: Some(HEIGHT) } },
            wgpu::Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        );
    }

    let cpu_start = Instant::now();
    queue.submit([encoder.finish()]);
    for buffer in [&color_readback, &id_readback, &query_readback] {
        buffer.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    }
    // Mapping completes only after the submission finished on the GPU: that is
    // the fence, and the attestation below rests on it having returned.
    device.poll(wgpu::Maintain::Wait);
    let cpu_end = Instant::now();

    // ----------------------------------------------------------------- results
    let queries = query_readback.slice(..).get_mapped_range().to_vec();
    let read_u64 = |offset: usize| u64::from_le_bytes(queries[offset..offset + 8].try_into().unwrap());
    let pass_ns = if timestamps {
        let (start, end) = (read_u64(0), read_u64(8));
        if end >= start && end != 0 { Some((end - start) as f64 * queue.get_timestamp_period() as f64) } else { None }
    } else { None };
    let statistics_values = statistics.then(|| (read_u64(64), read_u64(72)));
    drop(queries);
    query_readback.unmap();

    if run.is_null() {
        println!("not attached to the harness; rendered one frame on {} ({:?})", info.name, info.backend);
        return;
    }

    // SAFETY: plain FFI into the SDK for the rest of main; strings outlive each call.
    unsafe {
        if !software {
            let attested = match pass_ns {
                Some(_) => gdprobe::gdprobe_attest_gpu(run, gdprobe::GPU_TIMESTAMP_RESOLVED, c("pass timestamp writes resolved and mapped back").as_ptr()),
                None => gdprobe::gdprobe_attest_gpu(run, gdprobe::GPU_FENCE_SIGNALLED, c("readback map completed after submit; no timestamp feature").as_ptr()),
            };
            if attested != 0 {
                eprintln!("attestation refused: {}", gdprobe::last_error(run));
                gdprobe::gdprobe_run_discard(run);
                std::process::exit(1);
            }
            gdprobe::gdprobe_attest_performance(run, 1, c("timings below name what measured them").as_ptr());
        }

        let color_pixels = color_readback.slice(..).get_mapped_range();
        let id_pixels = id_readback.slice(..).get_mapped_range();
        let frame = gdprobe::gdprobe_frame_begin(run, 0, c("Main View").as_ptr());
        if frame.is_null()
            || gdprobe::gdprobe_attach_rgba8(frame, gdprobe::KIND_COLOR, std::ptr::null(), color_pixels.as_ptr() as *const _, WIDTH, HEIGHT, row_stride as usize) != 0
            || gdprobe::gdprobe_attach_ids(frame, gdprobe::KIND_OBJECT_ID, std::ptr::null(), id_pixels.as_ptr() as *const u32, WIDTH, HEIGHT, row_stride as usize) != 0
        {
            eprintln!("attach failed: {}", gdprobe::last_error(run));
            gdprobe::gdprobe_run_discard(run);
            std::process::exit(1);
        }
        gdprobe::gdprobe_frame_end(frame);
        drop(color_pixels);
        drop(id_pixels);

        let emit = |category: &str, name: &str, value: f64, unit: &str, frame_index: i32, measured_by| {
            gdprobe::gdprobe_emit_measured(run, c(category).as_ptr(), c(name).as_ptr(), value, c(unit).as_ptr(), frame_index, measured_by);
        };
        if let Some(ns) = pass_ns { emit("render", "pass.main.gpu_duration_ns", ns, "ns", 0, gdprobe::MEASURED_GPU_TIMESTAMP_QUERY); }
        if let Some((fragments, clipped)) = statistics_values {
            emit("render", "pipeline_statistics.fragment_invocations", fragments as f64, "count", 0, gdprobe::MEASURED_PIPELINE_STATISTICS_QUERY);
            emit("render", "pipeline_statistics.clipping_primitives", clipped as f64, "count", 0, gdprobe::MEASURED_PIPELINE_STATISTICS_QUERY);
            emit("render", "overdraw.fragments_per_pixel", fragments as f64 / (WIDTH * HEIGHT) as f64, "ratio", 0, gdprobe::MEASURED_PIPELINE_STATISTICS_QUERY);
        }
        emit("performance", "frame_time", cpu_end.duration_since(cpu_start).as_secs_f64() * 1e3, "ms", 0, gdprobe::MEASURED_WALL_CLOCK);
        emit("performance", "pipeline_creation_ms", compile_ms, "ms", -1, gdprobe::MEASURED_WALL_CLOCK);
        gdprobe::gdprobe_measure_measured(run, c("render.draw_calls").as_ptr(), 1.0, c("count").as_ptr(), c("sample").as_ptr(), 0, gdprobe::MEASURED_ENGINE_COUNTER);

        if gdprobe::gdprobe_run_end(run) != 0 {
            eprintln!("probe failed to finish: {}", gdprobe::last_error(run));
            gdprobe::gdprobe_run_discard(run);
            std::process::exit(1);
        }
    }
}
