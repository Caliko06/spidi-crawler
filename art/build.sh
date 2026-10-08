#!/bin/sh
# Builds the crawler and what Blender shows of it, all saved in
# art/spidi.blend: the model on its rig (spidi.py, which also exports
# assets/spidi.glb), the clips it acts out (clips.py, which also exports
# assets/clips.json), and a run of the real crawler keyed on it
# (preview/bake.mjs, preview/bake.py). `art/build.sh [seconds] [seed]`; then
# `node art/show.mjs` brings it into the open Blender.
set -e
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
RUN=$(mktemp -t spidi-run)
"$BLENDER" -b -P art/spidi.py > /dev/null
"$BLENDER" -b art/spidi.blend --python-expr "
import bpy
exec(open('art/clips.py').read())
bpy.ops.wm.save_mainfile()
" | grep clips:
node art/preview/bake.mjs "$RUN" "${1:-26}" "${2:-7}"
"$BLENDER" -b art/spidi.blend --python-expr "
import bpy
LABEL = 'Spidi · beast · run'; PATH = '$RUN'; SOURCE = 'Spidi · beast'
exec(open('art/preview/bake.py').read())
bpy.ops.wm.save_mainfile()
" > /dev/null
rm -f "$RUN" art/spidi.blend1
echo built art/spidi.blend
