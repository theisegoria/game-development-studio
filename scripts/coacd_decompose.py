#!/usr/bin/env python3
"""Bounded, isolated CoACD bridge. No installer, Blender, GPU, network or engine API.

Invoke only with an explicit virtualenv interpreter and Python -I -B. Native code
runs in this disposable child, after enforcing OS memory and CPU-time limits.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import pathlib
import platform
import sys
import threading

COACD_VERSION = "1.0.14"
NUMPY_VERSION = "2.0.2"
SOURCE_COMMIT = "1401ce2a7ae1ed89c65ab958b48d489350c233c7"
SUPPORTED = {("Linux", "x86_64"), ("Linux", "aarch64"), ("Darwin", "arm64"), ("Windows", "AMD64")}
_JOB_HANDLE = None


def environment():
    if (platform.system(), platform.machine()) not in SUPPORTED:
        raise ValueError(f"Unsupported CoACD wheel platform/architecture: {platform.system()}/{platform.machine() or '<unknown>'}. See docs/coacd.md for verified platforms and Python configuration.")
    if not ((3, 9) <= sys.version_info[:2] <= (3, 12)) or platform.python_implementation() != "CPython":
        raise ValueError("This pinned tool environment requires CPython 3.9 through 3.12")
    if sys.prefix == sys.base_prefix:
        raise ValueError("Configure an isolated virtual environment, not system or user-profile Python")
    config = pathlib.Path(sys.prefix) / "pyvenv.cfg"
    if not config.is_file() or "include-system-site-packages = false" not in config.read_text("utf8").lower():
        raise ValueError("CoACD requires a venv with system site packages disabled")
    if not sys.flags.isolated:
        raise ValueError("CoACD wrapper must be run with Python -I")
    versions = {name: importlib.metadata.version(name) for name in ("coacd", "numpy")}
    if versions != {"coacd": COACD_VERSION, "numpy": NUMPY_VERSION}:
        raise ValueError("Expected coacd==1.0.14 and numpy==2.0.2; use the pinned binary-only requirements")
    distribution = importlib.metadata.distribution("coacd")
    code_files = sorted(f for f in distribution.files or [] if str(f).endswith((".py", ".so", ".dll", ".dylib", ".pyd")))
    if not any("lib_coacd" in str(f) for f in code_files):
        raise ValueError("CoACD wheel has no native library")
    digest = hashlib.sha256()
    for relative in code_files:
        filename = pathlib.Path(distribution.locate_file(relative))
        try:
            filename.resolve().relative_to(pathlib.Path(sys.prefix).resolve())
        except ValueError:
            raise ValueError("CoACD package files must live inside the configured isolated venv")
        if filename.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("Unexpected oversized CoACD installed file")
        digest.update(str(relative).encode("utf8"))
        digest.update(filename.read_bytes())
    return {"schema": "game_dev.coacd_environment.v1", "python": platform.python_version(), "coacd": COACD_VERSION,
            "numpy": NUMPY_VERSION, "platform": platform.system(), "architecture": platform.machine(),
            "isolatedVenv": True, "coacdCodeSHA256": digest.hexdigest(), "upstreamSourceCommit": SOURCE_COMMIT}


def limits(memory_mb, cpu_seconds):
    """Hard CPU limits everywhere; macOS explicitly uses a sampled RSS guard."""
    global _JOB_HANDLE
    if platform.system() != "Windows":
        import resource
        mac = platform.system() == "Darwin"
        if not mac:
            resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        else:
            # macOS rejects RLIMIT_AS/RLIMIT_DATA. Check peak resident bytes every
            # 50 ms; the high-water mark catches a spike even if it was freed.
            # This is a best-effort guard, not a hard cap: sampling can overshoot.
            def watch_rss():
                while True:
                    if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss > memory_mb * 1024 * 1024:
                        os.write(2, b"CoACD RSS watchdog budget exceeded (sampled; overshoot possible)\n")
                        os._exit(125)
                    threading.Event().wait(0.05)
            threading.Thread(target=watch_rss, daemon=True).start()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
        if hasattr(os, "sched_getaffinity"):
            available = sorted(os.sched_getaffinity(0))
            os.sched_setaffinity(0, {available[0]})
        return {"memory": "sampled RSS watchdog; not a hard cap" if mac else "RLIMIT_AS", "cpu": "RLIMIT_CPU", "cpuAffinity": "one core" if hasattr(os, "sched_setaffinity") else "unavailable; aggregate CPU time capped",
                "memoryEnforcement": "sampled-rss-watchdog" if mac else "address-space-rlimit", "memorySampleIntervalMs": 50 if mac else None, "memoryOvershootPossible": mac}
    import ctypes
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
    class Extended(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
    handle = kernel.CreateJobObjectW(None, None)
    if not handle:
        raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
    settings = Extended()
    settings.BasicLimitInformation.LimitFlags = 0x2 | 0x8 | 0x100 | 0x2000
    settings.BasicLimitInformation.PerProcessUserTimeLimit = cpu_seconds * 10_000_000
    settings.BasicLimitInformation.ActiveProcessLimit = 1
    settings.ProcessMemoryLimit = memory_mb * 1024 * 1024
    if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(settings), ctypes.sizeof(settings)):
        raise OSError(ctypes.get_last_error(), "Cannot enforce CoACD process limits")
    process = kernel.GetCurrentProcess()
    if not kernel.AssignProcessToJobObject(handle, process):
        raise OSError(ctypes.get_last_error(), "Cannot assign CoACD worker to bounded job")
    # Windows hosts may restrict available CPUs. Query, then choose the lowest allowed bit.
    process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
    kernel.GetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p]
    if not kernel.GetProcessAffinityMask(process, ctypes.byref(process_mask), ctypes.byref(system_mask)):
        raise OSError(ctypes.get_last_error(), "Cannot query CPU affinity")
    if not kernel.SetProcessAffinityMask(process, process_mask.value & -process_mask.value):
        raise OSError(ctypes.get_last_error(), "Cannot enforce CPU affinity")
    _JOB_HANDLE = handle  # Keep alive until process exit; closing kills the worker.
    return {"memory": "Windows Job Object process-memory limit", "cpu": "Windows Job Object process CPU-time limit", "cpuAffinity": "one core", "memoryEnforcement": "windows-job-object", "memorySampleIntervalMs": None, "memoryOvershootPossible": False}


def run(args):
    env = environment()
    if args.diagnose:
        print(json.dumps(env, allow_nan=False))
        return
    options = json.loads(args.options)
    if set(options) != {"threshold", "maxParts", "maxVerticesPerPart", "seed", "memoryMB", "cpuSeconds", "timeoutSeconds"}:
        raise ValueError("Unexpected CoACD option contract")
    for name, low, high in [("maxParts", 1, 32), ("maxVerticesPerPart", 8, 256), ("seed", 0, 2147483647), ("memoryMB", 512, 4096), ("cpuSeconds", 10, 600), ("timeoutSeconds", 10, 600)]:
        value = options[name]
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise ValueError("Out-of-range CoACD option: " + name)
    if not isinstance(options["threshold"], (int, float)) or not math.isfinite(options["threshold"]) or not 0.01 <= options["threshold"] <= 0.2:
        raise ValueError("threshold must be between 0.01 and 0.2")
    # A child-side deadline still fires if the parent CLI crashes and loses its timer.
    wall_timer = threading.Timer(options["timeoutSeconds"], lambda: os._exit(124))
    wall_timer.daemon = True
    wall_timer.start()
    resource_limits = limits(options["memoryMB"], options["cpuSeconds"])
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[name] = "1"
    os.environ["OMP_THREAD_LIMIT"] = "1"
    os.environ["OMP_DYNAMIC"] = "FALSE"
    source = pathlib.Path(args.input)
    if source.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Collision interchange exceeds 16 MiB")
    payload = json.loads(source.read_text("utf8"))
    if payload.get("schema") != "game_dev.collision_triangles.v1":
        raise ValueError("Unknown collision interchange schema")
    vertices, faces = payload["vertices"], payload["faces"]
    if not 4 <= len(vertices) <= 60000 or not 4 <= len(faces) <= 20000:
        raise ValueError("Collision geometry exceeds bounds")
    for p in vertices:
        if len(p) != 3 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 1e6 for v in p):
            raise ValueError("Invalid collision coordinate")
    for triangle in faces:
        if len(triangle) != 3 or len(set(triangle)) != 3 or any(isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < len(vertices) for v in triangle):
            raise ValueError("Invalid collision index")
    print("CoACD CPU process: fixed seed, bounded memory and aggregate CPU time; no Blender/GPU/provider", file=sys.stderr, flush=True)
    import numpy as np
    import coacd
    coacd.set_log_level("error")
    parts = coacd.run_coacd(coacd.Mesh(np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int32)),
                            threshold=options["threshold"], max_convex_hull=options["maxParts"], preprocess_mode="auto",
                            preprocess_resolution=30, resolution=2000, mcts_nodes=20, mcts_iterations=100, mcts_max_depth=3,
                            pca=False, merge=True, decimate=True, max_ch_vertex=options["maxVerticesPerPart"],
                            extrude=False, apx_mode="ch", seed=options["seed"], real_metric=False)
    if not 1 <= len(parts) <= options["maxParts"]:
        raise ValueError("CoACD could not satisfy the part-count budget")
    output = []
    for points, triangles in parts:
        if points.ndim != 2 or points.shape[1] != 3 or triangles.ndim != 2 or triangles.shape[1] != 3:
            raise ValueError("Unexpected CoACD part array shape")
        if not 4 <= len(points) <= options["maxVerticesPerPart"] or len(triangles) > 2 * options["maxVerticesPerPart"] - 4:
            raise ValueError("CoACD exceeded per-part topology budgets")
        if not np.isfinite(points).all() or not ((triangles >= 0) & (triangles < len(points))).all():
            raise ValueError("CoACD returned non-finite coordinates or invalid indices")
        output.append({"vertices": points.tolist(), "faces": triangles.tolist()})
    result = {"schema": "game_dev.coacd_result.v1", "environment": env, "limits": resource_limits, "parts": output}
    target = pathlib.Path(args.output)
    with target.open("x", encoding="utf8") as handle:
        json.dump(result, handle, separators=(",", ":"), allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--options")
    try:
        run(parser.parse_args())
    except Exception as error:
        print(json.dumps({"schema": "game_dev.coacd_error.v1", "message": str(error)}), file=sys.stderr)
        sys.exit(1)
