"""The clips the crawler acts out: keyed on its rig in art/spidi.blend, one action each, and exported to assets/clips.json for src/clips.js.

Run by Blender in the background on art/spidi.blend (art/build.sh). Each clip
is keyed here once, as an animator would key it, on the rig's controls: the
thorax shoved and turned, each foot moved and held off the page, the jaws,
fangs, feelers, abdomen and spinnerets. The keys are Blender's: bezier,
eased, editable in the Graph Editor, and an edited action is exported as it
stands by running only the export (EXPORT_ONLY). The scene 'Spidi · beast'
plays every clip in turn on its timeline, its name over it.

Values are in the crawler's units at size 1, as src/crawler.js has them: x
along the body from the thorax joint, y out to its left, z up from the page;
`pitch` raises the head, `roll` drops the left side, `yaw` turns the head left.
Feet are where they are on the page against the thorax at rest.
"""
import json
import math
import os

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))  # art/spidi.blend is open
UNIT = 0.1
FPS = 60
GAP = 24  # frames between two clips on the reel
HEAD = 7.0  # the head joint, along from the thorax joint
TAIL = 8.0  # how long the abdomen hangs behind the belly joint, for its swing in px
EXPORT_ONLY = globals().get('EXPORT_ONLY', False)

rig = bpy.data.objects['rig']
scene = bpy.data.scenes['Spidi · beast']
LEGS = [f'{s}{i}' for i in range(1, 5) for s in 'LR']  # in the order of src/crawler.js: front pair first, left then right
REST = {name: rig.data.bones[f'foot_{name}'].head_local / UNIT for name in LEGS}
side = lambda name: 1 if name[0] == 'L' else -1


# ---------- the clips, keyed ----------
# Each clip: {channel: [(frame, value), ...]}. Channels:
#   'shove' (x, y, z)        the thorax moved off where it stands
#   'turn' (pitch, roll, yaw) the thorax turned
#   'sway' (up, side)        radians the abdomen swings up and to the left
#   'jaw'  radians each jaw swings out (0.1 shut, 0.5 open, 1.3 wide, fangs out from 0.35)
#   'spin' 0 to 1, the spinnerets turned out
#   'palp' (along, out)      each feeler's tip from the head, out to its own side
#   'L1' … 'R4' (x, y, z, held)  a foot: where it is, x and y from where it rests,
#        y out to its own side, and how far it is held off the page by the clip, 0 to 1
# A foot's x and y are offsets from rest so that one key serves both sides.

def legs(names, frames):
    """The same keys for each foot of `names`."""
    return {name: frames for name in names}


FRONT, SECOND, THIRD, REAR = ('L1', 'R1'), ('L2', 'R2'), ('L3', 'R3'), ('L4', 'R4')

CLIPS = {
    # It coils back and low, head up and jaws wide, then throws itself forward
    # onto what it hunts, front legs flung out and slammed down on it, the fangs
    # driven in as its head comes down.
    'strike': {
        'shove': [(0, (0, 0, 0)), (7, (-5.5, 0, -2.2)), (11, (15, 0, 2.6)), (14, (16, 0, -1.8)), (22, (13, 0, -1.2)), (38, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (7, (0.36, 0, 0)), (11, (-0.12, 0, 0)), (14, (-0.42, 0, 0)), (22, (-0.2, 0, 0)), (38, (0, 0, 0))],
        'jaw': [(0, 0.3), (7, 1.3), (12, 1.35), (14, 0.05), (24, 0.15), (34, 0.3)],
        'sway': [(0, (0, 0)), (7, (0.22, 0)), (13, (-0.18, 0)), (20, (0.06, 0)), (34, (0, 0))],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (5, (2, -3, 9, 1)), (8, (4, -4, 12, 1)), (11, (22, -6, 8, 1)), (14, (24, -10, 0, 1)), (26, (17, -9, 0, 1)), (38, (0, 0, 0, 0))]),
        **legs(SECOND, [(0, (0, 0, 0, 0)), (8, (1, 1, 3, 0.6)), (13, (13, 0, 2, 0.8)), (16, (14, 0, 0, 0.8)), (26, (10, 0, 0, 0.6)), (38, (0, 0, 0, 0))]),
        **legs(REAR, [(0, (0, 0, 0, 0)), (7, (-2, 1, 0, 0.5)), (12, (6, 0, 0, 0.5)), (22, (8, 0, 0, 0.5)), (38, (0, 0, 0, 0))]),
        'palp': [(0, (13, 5)), (7, (14, 9)), (12, (9, 2)), (34, (13, 5))],
    },
    # Its jaws locked in what it holds, it shakes it hard from side to side,
    # head and thorax whipping, the abdomen swinging the other way, the front
    # legs pinning it down.
    'thrash': {
        'shove': [(0, (0, 0, 0)), (4, (-1, 1.6, -0.5)), (8, (-1.2, -1.6, -0.5)), (12, (-1, 1.5, -0.5)), (16, (-1, -1.4, -0.5)), (20, (-0.8, 1.1, -0.4)), (25, (-0.6, -0.8, -0.3)), (31, (-0.3, 0.3, 0)), (44, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (4, (-0.16, 0.08, 0.36)), (8, (-0.18, -0.08, -0.36)), (12, (-0.16, 0.07, 0.33)), (16, (-0.16, -0.07, -0.31)), (20, (-0.14, 0.05, 0.25)), (25, (-0.12, -0.04, -0.18)), (31, (-0.06, 0, 0.08)), (44, (0, 0, 0))],
        'sway': [(0, (0, 0)), (6, (0, -0.3)), (10, (0, 0.3)), (14, (0, -0.28)), (18, (0, 0.26)), (22, (0, -0.2)), (27, (0, 0.14)), (33, (0, -0.05)), (44, (0, 0))],
        'jaw': [(0, 0.3), (3, 0.08), (36, 0.08), (44, 0.3)],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (3, (8, -9, 2, 1)), (6, (9, -10, 0, 1)), (36, (9, -10, 0, 1)), (44, (0, 0, 0, 0))]),
    },
    # Gripping with both front legs it tears what it holds apart: the legs
    # wrench outward, the body yanks back, the head jerks up and the jaws let go.
    'tear': {
        'shove': [(0, (0, 0, 0)), (10, (3, 0, -0.6)), (20, (-9, 0, 1.8)), (26, (-7, 0, 0)), (42, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (10, (-0.1, 0, 0)), (20, (0.34, 0, 0)), (28, (0.1, 0, 0)), (42, (0, 0, 0))],
        'jaw': [(0, 0.3), (10, 0.08), (19, 0.1), (21, 1.1), (42, 0.3)],
        'sway': [(0, (0, 0)), (20, (-0.25, 0)), (27, (0.12, 0)), (42, (0, 0))],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (6, (10, -10, 3, 1)), (10, (12, -12, 0.5, 1)), (21, (4, 4, 5, 1)), (28, (2, 6, 0, 1)), (42, (0, 0, 0, 0))]),
        **legs(SECOND, [(0, (0, 0, 0, 0)), (20, (-3, 2, 0, 0.5)), (42, (0, 0, 0, 0))]),
    },
    # Three stabs of the fangs, the head driven down each time, jaws flaring between.
    'stab': {
        'shove': [(0, (0, 0, 0)), (3, (-1.5, 0, 1.4)), (6, (4, 0, -1.8)), (9, (-0.8, 0, 1.2)), (12, (4, 0, -1.8)), (15, (-0.8, 0, 1.2)), (18, (5, 0, -2.2)), (28, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (3, (0.22, 0, 0)), (6, (-0.36, 0, 0.04)), (9, (0.16, 0, 0)), (12, (-0.36, 0, -0.04)), (15, (0.16, 0, 0)), (18, (-0.38, 0, 0)), (28, (0, 0, 0))],
        'jaw': [(0, 0.3), (3, 1.2), (6, 0.05), (9, 1.15), (12, 0.05), (15, 1.2), (18, 0.05), (28, 0.3)],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (3, (7, -8, 1, 1)), (5, (7, -8, 0, 1)), (22, (7, -8, 0, 1)), (28, (0, 0, 0, 0))]),
    },
    # It wraps what it holds in silk: abdomen up and spinnerets out, the hind
    # legs drawing silk over it in turns, one side then the other, the body rocking.
    'wrap': {
        'shove': [(0, (0, 0, 0)), (8, (-1, 0, -1)), (66, (-1, 0, -1)), (76, (0, 0, 0))],
        'turn': [(0, (0, 0, 0))] + [(8 + 9 * k, (-0.08, 0.12 * (-1) ** k, 0.05 * (-1) ** k)) for k in range(7)] + [(76, (0, 0, 0))],
        'sway': [(0, (0, 0)), (10, (0.36, 0)), (66, (0.36, 0)), (76, (0, 0))],
        'spin': [(0, 0), (8, 1), (66, 1), (76, 0)],
        'jaw': [(0, 0.3), (6, 0.12), (70, 0.12), (76, 0.3)],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (6, (7, -10, 3, 1)), (70, (7, -10, 3, 1)), (76, (0, 0, 0, 0))]),
        'L4': [(0, (0, 0, 0, 0))] + [(6 + 9 * k, ((14, -8, 7, 1) if k % 2 == 0 else (6, -11, 1.5, 1))) for k in range(7)] + [(76, (0, 0, 0, 0))],
        'R4': [(0, (0, 0, 0, 0))] + [(10 + 9 * k, ((14, -8, 7, 1) if k % 2 == 0 else (6, -11, 1.5, 1))) for k in range(6)] + [(76, (0, 0, 0, 0))],
    },
    # Its front legs raised high and brought down hard, twice, the body pumping into each blow.
    'stomp': {
        'shove': [(0, (0, 0, 0)), (4, (-1.6, 0, 3.4)), (8, (1.8, 0, -2.6)), (12, (-1.2, 0, 3)), (16, (2, 0, -2.8)), (34, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (4, (0.25, 0, 0)), (8, (-0.14, 0, 0)), (12, (0.22, 0, 0)), (16, (-0.16, 0, 0)), (34, (0, 0, 0))],
        'sway': [(0, (0, 0)), (9, (-0.2, 0)), (17, (-0.22, 0)), (34, (0, 0))],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (4, (4, -4, 13, 1)), (8, (7, -5, 0, 1)), (12, (4, -4, 12, 1)), (16, (7, -5, 0, 1)), (26, (5, -4, 0, 1)), (34, (0, 0, 0, 0))]),
    },
    # Up on its hind legs, front two pairs raised high and wide, fangs bared,
    # feelers spread, abdomen dropped: it will not be moved.
    'threat': {
        'shove': [(0, (0, 0, 0)), (12, (-2.5, 0, 6.5)), (60, (-2.5, 0, 6)), (82, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (12, (0.58, 0, 0)), (36, (0.52, 0, 0.12)), (60, (0.55, 0, -0.1)), (82, (0, 0, 0))],
        'sway': [(0, (0, 0)), (12, (-0.32, 0)), (60, (-0.3, 0)), (82, (0, 0))],
        'jaw': [(0, 0.3), (12, 1.4), (64, 1.4), (82, 0.3)],
        'palp': [(0, (13, 5)), (12, (15, 11)), (64, (15, 11)), (82, (13, 5))],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (12, (-1, 9, 27, 1)), (30, (1, 11, 25, 1)), (48, (-1, 8, 27, 1)), (64, (0, 10, 26, 1)), (82, (0, 0, 0, 0))]),
        **legs(SECOND, [(0, (0, 0, 0, 0)), (14, (4, 7, 16, 1)), (40, (5, 9, 15, 1)), (64, (4, 7, 16, 1)), (82, (0, 0, 0, 0))]),
    },
    # A word goes down: the head jerks down, jaws snap shut, the body sinks and the abdomen kicks.
    'gulp': {
        'shove': [(0, (0, 0, 0)), (4, (1.2, 0, -1.3)), (20, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (4, (-0.26, 0, 0)), (20, (0, 0, 0))],
        'jaw': [(0, 0.3), (2, 1.0), (6, 0.04), (20, 0.3)],
        'sway': [(0, (0, 0)), (6, (-0.22, 0)), (12, (0.1, 0)), (20, (0, 0))],
    },
    # It plucks a strand with one front leg, three sharp plucks, and holds still to feel what answers.
    'pluck': {
        'shove': [(0, (0, 0, 0)), (6, (-0.6, 0, -0.4)), (40, (-0.6, 0, -0.4)), (50, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (6, (0.06, 0, 0.1)), (40, (0.06, 0, 0.1)), (50, (0, 0, 0))],
        'L1': [(0, (0, 0, 0, 0)), (5, (4, -2, 9, 1)), (8, (6, -3, 0.4, 1)), (14, (4, -2, 9, 1)), (17, (6, -3, 0.4, 1)), (24, (4, -2, 9, 1)), (27, (6, -3, 0.4, 1)), (42, (6, -3, 0.4, 1)), (50, (0, 0, 0, 0))],
        'palp': [(0, (13, 5)), (8, (15, 3)), (42, (15, 3)), (50, (13, 5))],
    },
    # Hauling something behind it: leaned back, front legs locked forward on it, the next pair digging in.
    'drag': {
        'shove': [(0, (0, 0, 0)), (10, (-3, 0, -0.8)), (50, (-3, 0, -0.8)), (60, (0, 0, 0))],
        'turn': [(0, (0, 0, 0)), (10, (0.16, 0, 0)), (30, (0.12, 0.06, 0)), (50, (0.16, -0.05, 0)), (60, (0, 0, 0))],
        'jaw': [(0, 0.3), (8, 0.06), (52, 0.06), (60, 0.3)],
        'sway': [(0, (0, 0)), (10, (-0.15, 0)), (50, (-0.15, 0)), (60, (0, 0))],
        **legs(FRONT, [(0, (0, 0, 0, 0)), (8, (10, -9, 1, 1)), (52, (10, -9, 1, 1)), (60, (0, 0, 0, 0))]),
    },
    # Chewing what it has: the jaws work, the feelers turn it at the mouth.
    'chew': {
        'turn': [(0, (0, 0, 0)), (8, (-0.1, 0, 0)), (52, (-0.1, 0, 0)), (60, (0, 0, 0))],
        'jaw': [(0, 0.3)] + [(4 + 5 * k, 0.6 if k % 2 == 0 else 0.15) for k in range(11)] + [(60, 0.3)],
        'palp': [(0, (13, 5))] + [(4 + 6 * k, (10, 1.5) if k % 2 == 0 else (11.5, 3)) for k in range(9)] + [(60, (13, 5))],
    },
}


# ---------- keying them on the rig ----------

def world_to_local(bone, vector):
    """A vector in the armature's space as the pose bone's location takes it."""
    return bone.bone.matrix_local.to_3x3().inverted() @ vector


def rotation(pitch, roll, yaw):
    """The crawler's pitch (head up), roll (left side down) and yaw (head left) as a rotation in the armature's space."""
    return (Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(-pitch, 3, 'Y') @ Matrix.Rotation(-roll, 3, 'X'))


def local_rotation(bone, matrix):
    rest = bone.bone.matrix_local.to_3x3()
    return (rest.inverted() @ matrix @ rest).to_quaternion()


def key_clip(name, keys):
    """Makes the action `name` on the rig from `keys`."""
    if bpy.data.actions.get(name):
        bpy.data.actions.remove(bpy.data.actions[name])
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    poses = rig.pose.bones
    for bone in poses:
        bone.rotation_mode = 'QUATERNION'
    last = max(frame for frames in keys.values() for frame, _ in frames)
    thorax = poses['thorax']
    for frame, (x, y, z) in keys.get('shove', [(0, (0, 0, 0)), (last, (0, 0, 0))]):
        thorax.location = world_to_local(thorax, Vector((x, y, z)) * UNIT)
        thorax.keyframe_insert('location', frame=frame)
    for frame, (pitch, roll, yaw) in keys.get('turn', [(0, (0, 0, 0)), (last, (0, 0, 0))]):
        thorax.rotation_quaternion = local_rotation(thorax, rotation(pitch, roll, yaw))
        thorax.keyframe_insert('rotation_quaternion', frame=frame)
    abdomen = poses['abdomen']
    for frame, (up, sideways) in keys.get('sway', [(0, (0, 0)), (last, (0, 0))]):
        # The abdomen points back: raising its tail is a pitch up about its joint, swinging it left a yaw to the right.
        abdomen.rotation_quaternion = local_rotation(abdomen, Matrix.Rotation(-sideways, 3, 'Z') @ Matrix.Rotation(up, 3, 'Y'))
        abdomen.keyframe_insert('rotation_quaternion', frame=frame)
    for prop, default in (('jaw', 0.3), ('spin', 0.0)):
        for frame, value in keys.get(prop, [(0, default), (last, default)]):
            thorax[prop] = float(value)
            thorax.keyframe_insert(f'["{prop}"]', frame=frame)
            if prop == 'jaw':
                for s in 'LR':
                    jaw = poses[f'chelicera_{s}']
                    jaw.rotation_quaternion = local_rotation(jaw, Matrix.Rotation(side(s) * (value - 0.22), 3, 'Z'))
                    jaw.keyframe_insert('rotation_quaternion', frame=frame)
    for frame, (reach, out) in keys.get('palp', [(0, (13, 5)), (last, (13, 5))]):
        for s in 'LR':
            palp = poses[f'palp_{s}']
            base = palp.bone.head_local
            rest_tip = palp.bone.tail_local - base
            tip = Vector((HEAD + reach, side(s) * out, 0.9)) * UNIT - base
            palp.rotation_quaternion = local_rotation(palp, rest_tip.rotation_difference(tip).to_matrix())
            palp.keyframe_insert('rotation_quaternion', frame=frame)
            palp['reach'], palp['out'] = float(reach), float(out)
            palp.keyframe_insert('["reach"]', frame=frame)
            palp.keyframe_insert('["out"]', frame=frame)
    for name in LEGS:
        foot = poses[f'foot_{name}']
        for frame, (dx, dy, z, held) in keys.get(name, [(0, (0, 0, 0, 0)), (last, (0, 0, 0, 0))]):
            foot.location = world_to_local(foot, Vector((dx, side(name) * dy, z)) * UNIT)
            foot['held'] = float(held)
            foot.keyframe_insert('location', frame=frame)
            foot.keyframe_insert('["held"]', frame=frame)
    action.frame_range = (0, last)
    return action


# ---------- reading them back ----------

def sample(action):
    """Every frame of `action`, as src/clips.js reads it."""
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = action
    start, end = map(int, action.frame_range)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    rest_thorax = rig.data.bones['thorax'].matrix_local
    rest_abdomen = rig.data.bones['abdomen'].matrix_local.to_3x3()
    frames = []
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        depsgraph.update()
        poses = rig.evaluated_get(depsgraph).pose.bones
        thorax = poses['thorax']
        moved = thorax.matrix  # in the armature's space
        shove = (moved.translation - rest_thorax.translation) / UNIT
        turned = moved.to_3x3() @ rest_thorax.to_3x3().inverted()
        forward = turned @ Vector((1, 0, 0))
        left = turned @ Vector((0, 1, 0))
        pitch = math.asin(max(-1, min(1, forward.z)))
        yaw = math.atan2(forward.y, forward.x)
        roll = -math.asin(max(-1, min(1, left.z)))
        hung = (poses['abdomen'].matrix.to_3x3() @ rest_abdomen.inverted()) @ Vector((-1, 0, 0))
        hung = turned.inverted() @ hung  # against the thorax
        # Blender's left (+y) is the page's up, src/crawler.js's side -1: what goes to a side is turned over for it.
        row = {
            'shove': [round(shove.x, 3), round(-shove.y, 3), round(shove.z, 3)],
            'turn': [round(pitch, 4), round(-roll, 4), round(-yaw, 4)],
            'sway': [round(hung.z * TAIL, 3), round(-hung.y * TAIL, 3)],
            'jaw': round(thorax.get('jaw', 0.3), 4),
            'spin': round(thorax.get('spin', 0.0), 4),
            'palp': [round(poses['palp_L'].get('reach', 13), 3), round(poses['palp_L'].get('out', 5), 3)],
            'feet': [],
        }
        for name in LEGS:
            foot = poses[f'foot_{name}']
            at = foot.head / UNIT
            row['feet'].append([round(at.x, 3), round(at.y * side(name), 3), round(at.z, 3), round(foot.get('held', 0.0), 4)])
        frames.append(row)
    return frames


def channels(keys):
    """What a clip moves, as the parts src/moves.js speaks of."""
    used = set()
    if 'shove' in keys:
        used |= {'height', 'lean'}
    if 'turn' in keys:
        used |= {'tilt', 'turn'}
    if 'sway' in keys:
        used.add('abdomen')
    if 'jaw' in keys:
        used.add('jaws')
    if 'spin' in keys:
        used.add('spinnerets')
    if 'palp' in keys:
        used.add('feelers')
    used |= {f'leg{LEGS.index(name)}' for name in LEGS if name in keys}
    return sorted(used)


def reel(actions):
    """Lays every clip on the rig's timeline in turn, with its name in a text over the stage."""
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    track = rig.animation_data.nla_tracks.new()
    track.name = 'reel'
    label = bpy.data.objects.get('clip name')
    if not label:
        curve = bpy.data.curves.new('clip name', 'FONT')
        curve.size = 0.6
        curve.align_x = 'CENTER'
        label = bpy.data.objects.new('clip name', curve)
        label.location = (0.4, -3.2, 0.01)
        ink = bpy.data.materials.get('ink')
        if ink:
            curve.materials.append(ink)
        scene.collection.children['Page'].objects.link(label)
    names = []
    at = 1
    for action in actions:
        start, end = action.frame_range
        strip = track.strips.new(action.name, int(at), action)
        strip.blend_in = strip.blend_out = 0
        names.append((int(at), action.name))
        at += (end - start) + GAP
    scene.frame_start, scene.frame_end = 1, int(at)
    scene.render.fps = FPS
    # The text says the name of the clip being played.
    def name_at(scene_, *_):
        frame = scene_.frame_current
        shown = next((n for f, n in reversed(names) if frame >= f), names[0][1])
        if label.data.body != shown:
            label.data.body = shown
    bpy.app.handlers.frame_change_pre[:] = [h for h in bpy.app.handlers.frame_change_pre if getattr(h, '__name__', '') != 'name_at']
    bpy.app.handlers.frame_change_pre.append(name_at)
    # Keyed too, so the name shows without the handler: one text per clip, shown while it plays.
    label.data.body = ''
    for start, name in names:
        own = bpy.data.objects.get(f'clip {name}')
        if not own:
            own = bpy.data.objects.new(f'clip {name}', label.data.copy())
            scene.collection.children['Page'].objects.link(own)
        own.data.body = name
        own.location = label.location
        end = next((f for f, _ in names if f > start), int(at))
        for frame, hidden in ((1, True), (start, False), (end, True)):
            own.hide_render = own.hide_viewport = hidden
            own.keyframe_insert('hide_render', frame=frame)
            own.keyframe_insert('hide_viewport', frame=frame)
    bpy.app.handlers.frame_change_pre.remove(name_at)
    bpy.data.objects.remove(label)


def main():
    # The scene may not be the one the file opens on, and only that one is evaluated: work in it.
    with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
        run()


def run():
    actions = []
    for name, keys in CLIPS.items():
        action = bpy.data.actions.get(name) if EXPORT_ONLY else key_clip(name, keys)
        actions.append(action)
    out = {'fps': FPS, 'clips': {}}
    for action, (name, keys) in zip(actions, CLIPS.items()):
        out['clips'][name] = {'uses': channels(keys), 'frames': sample(action)}
    rig.animation_data.action = None
    # Back at rest for the reel.
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
    reel(actions)
    with open(os.path.join(ROOT, 'assets', 'clips.json'), 'w') as file:
        json.dump(out, file, separators=(',', ':'))
    print('clips:', ', '.join(f"{n} {len(c['frames'])}" for n, c in out['clips'].items()))


main()
