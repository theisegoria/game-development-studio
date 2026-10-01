#!/bin/sh
# Compile the shaders to SPIR-V and the example against the Vulkan loader.
# Output lands beside this script: gdprobe-vulkan plus two .spv files it loads
# from its own directory at runtime, so there is no embedding step.
set -eu
cd "$(dirname "$0")"
glslc -O shader.vert -o shader.vert.spv
glslc -O shader.frag -o shader.frag.spv
: "${VULKAN_SDK:=}"
INCLUDE=""; LIB=""
# The rpath matters: without it a macOS binary linked against the SDK's
# loader aborts at load time with "no LC_RPATH's found".
if [ -n "$VULKAN_SDK" ]; then INCLUDE="-I$VULKAN_SDK/include"; LIB="-L$VULKAN_SDK/lib -Wl,-rpath,$VULKAN_SDK/lib"; fi
if [ -f /usr/local/include/vulkan/vulkan.h ]; then INCLUDE="$INCLUDE -I/usr/local/include"; LIB="$LIB -L/usr/local/lib -Wl,-rpath,/usr/local/lib"; fi
# shellcheck disable=SC2086
cc -std=c99 -Wall -Wextra -Werror $INCLUDE ../../c/gdprobe.c main.c -o gdprobe-vulkan $LIB -lvulkan
echo "built ./gdprobe-vulkan"
