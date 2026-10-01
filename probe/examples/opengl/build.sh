#!/bin/sh
# macOS: CGL context, OpenGL.framework (deprecated by Apple, still shipped).
# Linux: surfaceless EGL context, Mesa's libGL and libEGL.
set -eu
cd "$(dirname "$0")"
case "$(uname -s)" in
  Darwin)
    cc -std=c99 -Wall -Wextra -Werror ../../c/gdprobe.c main.c -o gdprobe-opengl -framework OpenGL ;;
  *)
    cc -std=c99 -Wall -Wextra -Werror ../../c/gdprobe.c main.c -o gdprobe-opengl -lGL -lEGL ;;
esac
echo "built ./gdprobe-opengl"
