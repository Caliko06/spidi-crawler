"""Brings the scenes of art/spidi.blend into the Blender that is open, for you to look at.

Sent to the open Blender (its blender-mcp socket, port 9876) by art/show.mjs. The
scenes named in SCENES replace any earlier copies of themselves; every other
scene is left as it is. The window is then set to show the first, rendered,
through its camera, from its first frame.
"""
import bpy

PATH = globals().get('PATH')
SCENES = globals().get('SCENES', ['Spidi · beast'])

for name in SCENES:
    old = bpy.data.scenes.get(name)
    if not old:
        continue
    for obj in list(old.objects):
        if len(obj.users_scene) == 1:
            bpy.data.objects.remove(obj)
    for child in list(old.collection.children_recursive):
        if child.users <= 1:
            bpy.data.collections.remove(child)
    bpy.data.scenes.remove(old)

with bpy.data.libraries.load(PATH, link=False) as (source, into):
    into.scenes = [name for name in source.scenes if name in SCENES]

shown = bpy.data.scenes[SCENES[0]]
for window in bpy.context.window_manager.windows:
    window.scene = shown
    for area in window.screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces[0]
            space.shading.type = 'RENDERED'
            space.region_3d.view_perspective = 'CAMERA'
            space.overlay.show_overlays = False
shown.frame_set(shown.frame_start)
print('shown', [s.name for s in bpy.data.scenes])
