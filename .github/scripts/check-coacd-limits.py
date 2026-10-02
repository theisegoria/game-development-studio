"""Remote CI only: prove worker resource controls interrupt bounded synthetic loads.
No CoACD import, provider, Blender, GPU or user-directory mutation.
"""
import importlib.util
import json
import os
import pathlib
import platform
import subprocess
import sys
import time


def child(mode):
    wrapper = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "coacd_decompose.py"
    spec = importlib.util.spec_from_file_location("coacd_bridge", wrapper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if mode == "memory":
        module.limits(96, 8)
        blocks = []
        try:
            # At most 256 MiB attempted; 96 MiB guard must stop well before this.
            for _ in range(64):
                block = bytearray(4 * 1024 * 1024)
                for offset in range(0, len(block), 4096):
                    block[offset] = 1
                blocks.append(block)
                time.sleep(0.025)
        except MemoryError:
            sys.exit(42)
        time.sleep(0.2)
        sys.exit(0)  # A successful unrestricted allocation means the guard failed.
    module.limits(256, 1)
    while True:
        pass


if __name__ == "__main__":
    if len(sys.argv) == 2:
        child(sys.argv[1])
    else:
        outcomes = {}
        for mode in ("memory", "cpu"):
            process = subprocess.Popen([sys.executable, "-I", "-B", __file__, mode], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                out, err = process.communicate(timeout=12)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise RuntimeError(mode + " resource control did not interrupt the worker")
            if mode == "memory":
                expected = 125 if platform.system() == "Darwin" else 42
                if process.returncode != expected:
                    raise RuntimeError("Memory guard returned " + str(process.returncode) + ": " + err.decode(errors="replace"))
            elif process.returncode == 0 or b"Traceback" in err:
                raise RuntimeError("CPU guard failed: " + err.decode(errors="replace"))
            outcomes[mode] = {"exitCode": process.returncode, "interrupted": True}
        print(json.dumps({"platform": platform.system(), "syntheticResourceChecks": outcomes}))
