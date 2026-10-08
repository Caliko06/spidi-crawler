# Builds the crawler: a spider, modelled part by part, set on the page it reads.
# It is drawn as an instrument would draw it, in flat facets: each part a few
# clean planes, each leg a chain of tapered prisms with a knuckle at each joint.
# Run by Blender in the background, it saves the scene it builds as
# art/spidi.blend, the parts riding a rig that poses them as the reader does,
# and exports the parts as assets/spidi.glb, which the reader poses and
# lights itself. art/show.py brings the scene into an open Blender.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P art/spidi.py
#
# Measures are in the crawler's own units, those of src/crawler.js at size 1,
# with the body facing +X on a page that lies in XY. A part is modelled where
# it is carried above the page, around the joint it turns on, so the reader
# can place it by that joint alone; the measures the reader needs to do so
# travel with the model, on its root.

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIT = 0.1  # Blender units to one of the crawler's

# The body as src/crawler.js moves it: its size on the page, the gaps of its
# spine, where its legs are hinged and where their feet rest, how long a leg's
# two parts are and how its knee leans.
SIZE = 2.4
HEAD = 7.0  # from the thorax joint forward to the head joint
BELLY = 10.0  # and back to the belly joint
TAIL = 8.0  # from the belly joint back to the tail
# Each pair: its hip, its foot's rest along and out, the lengths of its three
# parts, hip to knee, knee to ankle and ankle to foot, and how thick it is against the second.
LEGS = [(3.5, 26, 17, 16.0, 12.0, 13.5, 1.45), (1.2, 10, 25, 13.5, 9.5, 10.5, 1.15), (-1.2, -6, 22, 11.5, 8.0, 9.0, 1.0), (-3.5, -23, 19, 14.5, 10.5, 12.5, 1.2)]
TARSUS_PITCH = 1.0  # radians the last part of a planted leg rises from its foot to its ankle, as src/crawler.js has it
LEG_HIP = 3.0
LEG_HIP_HEIGHT = 3.4
KNEE_SPLAY = 1.1

# How high above the page the rest is carried.
PROSOMA_Z = 4.3
ABDOMEN_Z = 5.0
ABDOMEN_SIZE = (9.4, 5.5)  # half its length, and half its width where the reader measures its girth
PALP_Z = (3.2, 0.9)  # a feeler's base and its tip
JAW_Z = 3.5

PALP = 11.0
SHARP = 38  # degrees between two faces from which the edge they share is drawn sharp
MARKS = 5  # chevrons down the abdomen, lit one by one as it fills

# Colours, linear. The body is pale, a step above the page's ink, so it stands
# out from both the page and its text; its markings are dark until lit.
CARAPACE = np.array((0.230, 0.255, 0.310))
LEG = np.array((0.250, 0.280, 0.330))
ABDOMEN = np.array((0.120, 0.140, 0.190))
JOINT = np.array((0.090, 0.100, 0.118))  # the knuckles between the segments of a limb
MARK = np.array((0.018, 0.022, 0.030))  # its markings, before the reader lights them
PAGE = (0.0030, 0.0037, 0.0052)  # #0a0c10
CATCH = (0.107, 0.887, 0.539)  # #5cf2c2


# ---------- curves ----------

def spline(table, at):
    """The rows of `table` are (x, a, b, …) with x rising; their values at `at`, along a smooth curve through the rows."""
    table = np.asarray(table, float)
    x, values = table[:, 0], table[:, 1:]
    slope = np.gradient(values, x, axis=0)
    at = np.asarray(at, float)
    i = np.clip(np.searchsorted(x, at) - 1, 0, len(x) - 2)
    width = (x[i + 1] - x[i])[:, None]
    s = ((at - x[i]) / width[:, 0])[:, None]
    return ((2 * s**3 - 3 * s**2 + 1) * values[i] + (s**3 - 2 * s**2 + s) * width * slope[i]
            + (-2 * s**3 + 3 * s**2) * values[i + 1] + (s**3 - s**2) * width * slope[i + 1])


def rounded(stations):
    """`stations` with a round end added before the first and after the last: rows (x, …) that close to a point a little beyond each."""
    stations = [np.asarray(row, float) for row in stations]
    out = []
    for end, sign in ((stations[0], -1), (stations[-1], 1)):
        reach = end[1] * 0.8  # how far beyond the station the end closes, by its half-width
        cap = []
        for degrees in (0, 22, 45, 68):
            a = math.radians(degrees)
            row = end * math.sin(a)
            row[0] = end[0] + sign * reach * math.cos(a)
            row[-1] = end[-1]  # the centre line does not close
            cap.append(row)
        out.append(cap if sign < 0 else cap[::-1])
    return out[0] + stations + out[1]


# ---------- meshes ----------

class Shape:
    """Vertices, faces and vertex colours gathered from several surfaces, to be made one mesh."""

    def __init__(self):
        self.verts, self.faces, self.colours = [], [], []

    def add(self, verts, faces, colours):
        base = len(self.verts)
        self.verts.extend(map(tuple, verts))
        self.faces.extend(tuple(base + i for i in face) for face in faces)
        self.colours.extend(map(tuple, colours))

    def grid(self, points, colours, close):
        """A surface through `points[ring][around]`, closed around; `close` gives the point each end closes to, or None."""
        rings, around = points.shape[:2]
        verts = list(points.reshape(-1, 3))
        cols = list(colours.reshape(-1, 3))
        faces = []
        for k in range(rings - 1):
            for j in range(around):
                a, b = k * around + j, k * around + (j + 1) % around
                faces.append((a, b, b + around, a + around))
        for end, pole in zip((0, rings - 1), close):
            if pole is None:
                continue
            verts.append(pole)
            cols.append(colours[end].mean(axis=0))
            for j in range(around):
                a, b = end * around + j, end * around + (j + 1) % around
                faces.append((len(verts) - 1, b, a) if end == 0 else (len(verts) - 1, a, b))
        self.add(verts, faces, cols)

    def build(self, name, material, smooth=False, recalc=False):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(c * UNIT for c in v) for v in self.verts], [], self.faces)
        if recalc:
            # Wound outward, whatever order its faces were gathered in.
            made = bmesh.new()
            made.from_mesh(mesh)
            bmesh.ops.recalc_face_normals(made, faces=made.faces)
            made.to_mesh(mesh)
            made.free()
        # Smooth over its plates, sharp where two meet at an edge: the rims, ridges and the facets of a limb.
        mesh.shade_smooth()
        if not smooth:
            mesh.set_sharp_from_angle(angle=math.radians(SHARP))
        colour = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        colour.data.foreach_set('color', [c for rgb in self.colours for c in (*rgb, 1.0)])
        mesh.materials.append(material)
        return mesh


class Body:
    """A body lofted along X through `stations`: rows (x, half-width, height above its centre line, depth below it, height of the centre line)."""

    def __init__(self, stations, power, closed=False):
        self.table = [np.asarray(row, float) for row in stations] if closed else rounded(stations)  # `closed`, its stations already narrow to a point at both ends
        self.power = power
        self.x0, self.x1 = self.table[0][0], self.table[-1][0]

    def at(self, x):
        w, top, bottom, z = spline(self.table, np.atleast_1d(x)).T
        return np.maximum(w, 1e-4), np.maximum(top, 1e-4), np.maximum(bottom, 1e-4), z

    def top(self, x, y, lift=0.0):
        """The point of its back above (x, y), raised by `lift`."""
        w, top, _, z = self.at(x)
        across = np.clip(np.abs(y) / w, 0, 0.999)
        return np.stack([np.broadcast_to(x, across.shape), np.broadcast_to(y, across.shape), z + top * (1 - across**self.power) ** (1 / self.power) + lift], axis=-1)

    def surface(self, shape, rings, around, finish):
        """Adds its surface to `shape`. `finish(x, y, up)` gives, for points at `x`, `y` across and `up` from -1 underneath to 1 on its back, how far each is pressed in, as a share, and its colour."""
        s = (1 - np.cos(np.pi * np.arange(1, rings + 1) / (rings + 1))) / 2  # closer together toward the ends, where it curves most
        x = self.x0 + (self.x1 - self.x0) * s
        w, top, bottom, z = self.at(x)
        phi = 2 * np.pi * np.arange(around) / around
        c, sn = np.cos(phi), np.sin(phi)
        bend = lambda v: np.sign(v) * np.abs(v) ** (2 / self.power)
        y = w[:, None] * bend(c)[None, :]
        height = np.where(sn[None, :] >= 0, top[:, None], bottom[:, None]) * bend(sn)[None, :]
        X = np.broadcast_to(x[:, None], y.shape)
        pressed, colours = finish(X, y, np.broadcast_to(bend(sn)[None, :], y.shape))
        points = np.stack([X, y * (1 - pressed), z[:, None] + height * (1 - pressed)], axis=-1)
        w0, _, _, z0 = self.at(self.x0)
        w1, _, _, z1 = self.at(self.x1)
        shape.grid(points, colours, ((self.x0, 0, z0[0]), (self.x1, 0, z1[0])))


def tube(shape, path, radii, samples, around, colour, closed=(True, True)):
    """Adds a limb to `shape`: round, along a smooth curve through `path`, as thick as `radii` says, rows (share of its length, radius). `colour(t)` gives the colour at each share of its length."""
    path = np.asarray(path, float)
    chord = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    t = np.linspace(0, 1, samples)
    centre = spline(np.column_stack([chord / chord[-1], path]), t)
    radius = spline(radii, t)[:, 0]
    tangent = np.gradient(centre, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    side = np.cross((0, 0, 1), tangent)
    side /= np.linalg.norm(side, axis=1)[:, None]
    up = np.cross(tangent, side)
    phi = 2 * np.pi * np.arange(around) / around
    points = centre[:, None, :] + radius[:, None, None] * (np.cos(phi)[None, :, None] * side[:, None, :] + np.sin(phi)[None, :, None] * up[:, None, :])
    colours = np.broadcast_to(np.asarray(colour(t))[:, None, :], points.shape)
    shape.grid(points, colours, (tuple(centre[0] - tangent[0] * radius[0] * 0.6) if closed[0] else None, tuple(centre[-1] + tangent[-1] * radius[-1] * 0.6) if closed[1] else None))


def needles(shape, start, end, radius, places, length, colour):
    """Adds spines to a segment of a limb from `start` to `end`: at each of `places`, rows (share of its length, angle around it), a three-sided needle standing out of its skin and leaning toward its far end."""
    start, end = np.asarray(start, float), np.asarray(end, float)
    tangent = (end - start) / np.linalg.norm(end - start)
    side = np.cross((0, 0, 1), tangent)
    side /= np.linalg.norm(side)
    for t, angle in places:
        out = math.cos(angle) * side + math.sin(angle) * np.cross(tangent, side)
        root = start + (end - start) * t + out * radius * 0.8
        lean = out * 0.5 + tangent * 0.87
        tube(shape, [root, root + lean * length * 0.5, root + lean * length], [(0, 0.07), (1, 0.01)], 3, 3, lambda t: np.tile(colour, (len(t), 1)), closed=(False, True))


RNG = np.random.default_rng(11)


def bristles(shape, body, count, length, radius, colour, where, lean=(-0.55, 0.0), up=0.8, around=3):
    """Adds `count` fine hairs standing out of the back of `body`, at the points `where(x, y)` says (a weight, 0 to 1), each leaning along `lean` (x, y) and `up` from the skin, `length` long (a spread of it), in `colour` (a spread of it)."""
    made = 0
    while made < count:
        s = RNG.random()
        x = body.x0 + (body.x1 - body.x0) * s
        w = body.at(x)[0][0]
        y = (RNG.random() * 2 - 1) * w
        if RNG.random() > where(x, y):
            continue
        root = body.top(np.array([x]), np.array([y]), -0.05)[0]
        out = np.array((lean[0] + RNG.normal() * 0.25, lean[1] + np.sign(y) * 0.35 + RNG.normal() * 0.25, up))
        out /= np.linalg.norm(out)
        reach = length * (0.6 + 0.8 * RNG.random())
        tone = np.asarray(colour, float) * (0.7 + 0.8 * RNG.random())
        # Soft: it rises, then bends over under its own weight, toward where it is combed.
        bend = np.array((lean[0], lean[1], -0.55)) * reach * 0.5
        tube(shape, [root, root + out * reach * 0.45, root + out * reach * 0.8 + bend * 0.6, root + out * reach + bend], [(0, radius), (0.6, radius * 0.6), (1, radius * 0.08)], 4, around, lambda t, tone=tone: np.tile(tone, (len(t), 1)), closed=(False, True))
        made += 1


def setae(shape, start, end, radius, count, length, colour, spread=2 * math.pi, centre=0.0, lean=0.7):
    """Adds `count` fine hairs along a limb segment from `start` to `end`, standing out all round it (within `spread` radians about `centre`) and leaning toward its far end by `lean`."""
    start, end = np.asarray(start, float), np.asarray(end, float)
    tangent = (end - start) / np.linalg.norm(end - start)
    side = np.cross((0, 0, 1), tangent)
    side /= np.linalg.norm(side)
    above = np.cross(tangent, side)
    for _ in range(count):
        t = 0.05 + 0.9 * RNG.random()
        angle = centre + (RNG.random() - 0.5) * spread
        out = math.cos(angle) * side + math.sin(angle) * above
        root = start + (end - start) * t + out * radius * 0.85
        direction = out * (1 - lean) + tangent * lean
        direction /= np.linalg.norm(direction)
        reach = length * (0.6 + 0.8 * RNG.random())
        tone = np.asarray(colour, float) * (0.7 + 0.7 * RNG.random())
        tube(shape, [root, root + direction * reach * 0.4 + out * reach * 0.1, root + direction * reach * 0.8 + out * reach * 0.12, root + direction * reach + out * reach * 0.06 + tangent * reach * 0.12], [(0, 0.03), (0.6, 0.02), (1, 0.003)], 4, 3, lambda t, tone=tone: np.tile(tone, (len(t), 1)), closed=(False, True))


def lathe(shape, a, b, stations, around, bow=0.0, twist=0.0, close=(True, True)):
    """Adds a sclerite from `a` to `b`, turned like a lathe would: rings at `stations`, rows (share of its length, radius, r, g, b), each an `around`-gon with a flat face on top; its axis bowed up by `bow` of its length at the middle. Gives its centre line's ends."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    length = np.linalg.norm(b - a)
    u = (b - a) / length
    side = np.cross((0, 0, 1), u)
    side = side / np.linalg.norm(side) if np.linalg.norm(side) > 1e-6 else np.array((0.0, 1.0, 0.0))
    up = np.cross(u, side)
    stations = np.asarray(stations, float)
    t = stations[:, 0]
    centre = a[None, :] + np.outer(t, b - a) + np.outer(4 * t * (1 - t) * bow * length, up)
    tangent = np.gradient(centre, t, axis=0) if len(t) > 2 else np.tile(u, (len(t), 1))
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    sides = np.cross(up[None, :], tangent)
    sides /= np.linalg.norm(sides, axis=1)[:, None]
    ups = np.cross(tangent, sides)
    phi = 2 * np.pi * (np.arange(around) + 0.5) / around + twist
    points = centre[:, None, :] + stations[:, 1, None, None] * (np.cos(phi)[None, :, None] * sides[:, None, :] + np.sin(phi)[None, :, None] * ups[:, None, :])
    colours = np.broadcast_to(stations[:, None, 2:5], points.shape)
    shape.grid(points, colours, (tuple(centre[0]) if close[0] else None, tuple(centre[-1]) if close[1] else None))
    return centre[0], centre[-1]


def sclerite(r0, r1, swell=1.06, band=0.0, base=None, socket=True):
    """The stations of a limb segment from radius `r0` to `r1`: sunk into a socket at its start, swelling a little, then a dark band and a bevelled rim at its end, where the next turns. `band` is how dark the band is, 0 for none."""
    base = LEG if base is None else base
    pale, dark, rim = base * 1.7, base * (1 - 0.92 * band), base * 2.1
    mid = max(r0, r1) * swell
    rows = [
        (0.00, r0 * 0.74, *(JOINT * 1.4)),  # the socket, sunk in the rim of the segment before
        (0.035, r0 * 0.94, *(base * 0.95)),
        (0.08, r0 * 1.0, *pale),
        (0.38, mid, *pale),
        (0.66, (r0 + r1) / 2 * 1.02, *(base * 1.05)),
        (0.74, r1 * 1.03, *dark),
        (0.90, r1 * 1.08, *dark),
        (0.94, r1 * 1.17, *rim),  # the rim, bevelled on both sides so it catches the light
        (0.975, r1 * 1.13, *rim),
        (1.00, r1 * 0.86, *(base * 0.8)),
    ]
    return rows if socket else rows[1:]


def limb(shape, joints, radii, bands, around=12, bows=None, swell=1.06, base=None):
    """Adds a jointed limb to `shape`: from each of `joints` to the next a turned segment (`sclerite`), tapering as `radii` says, rows (radius at its start, at its end), dark before its end by as much as `bands` says; between two, a dark membrane the next one turns on. Gives each segment's start and end."""
    joints = [np.asarray(joint, float) for joint in joints]
    bows = bows or [0.0] * len(radii)
    made = []
    for k, ((r0, r1), a, b) in enumerate(zip(radii, joints, joints[1:])):
        u = (b - a) / np.linalg.norm(b - a)
        start = a + u * (min(r0, radii[k - 1][1]) * 0.22 if k else 0)
        end = b - u * (min(r1, radii[k + 1][0]) * 0.22 if k + 1 < len(radii) else 0)
        lathe(shape, start, end, sclerite(r0, r1, swell, bands[k], base, socket=k > 0), around, bows[k])
        if k:
            # The membrane: a short dark collar from inside the rim before to inside this socket.
            r = min(r0, radii[k - 1][1])
            back = joints[k] - (joints[k] - joints[k - 1]) / np.linalg.norm(joints[k] - joints[k - 1]) * r * 0.5
            lathe(shape, back, start + u * r * 0.15, [(0, r * 0.82, *JOINT), (0.5, r * 0.7, *(JOINT * 0.8)), (1, r * 0.76, *JOINT)], around, close=(False, False))
        made.append((start, end))
    return made


def ball(shape, centre, radius, colour, rings=3, around=6):
    lat = np.pi * np.arange(1, rings + 1) / (rings + 1)
    phi = 2 * np.pi * np.arange(around) / around
    points = np.asarray(centre)[None, None, :] + radius * np.stack([np.broadcast_to(-np.cos(lat)[:, None], (rings, around)), np.sin(lat)[:, None] * np.cos(phi)[None, :], np.sin(lat)[:, None] * np.sin(phi)[None, :]], axis=-1)
    shape.grid(points, np.broadcast_to(np.asarray(colour, float), points.shape), ((centre[0] - radius, centre[1], centre[2]), (centre[0] + radius, centre[1], centre[2])))


def smooth(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def mottle(x, y, scale, depth):
    """A soft unevenness of colour over (x, y), between 1 - depth and 1 + depth."""
    return np.array([[1 + depth * noise.noise(Vector((a * scale, b * scale, 0.0))) for a, b in zip(xs, ys)] for xs, ys in zip(x, y)])


# ---------- materials ----------

def material(name, roughness, coat=0.0, sheen=0.0, colour=None, emission=None, flat=False, specular=0.5):
    """`flat`, it has no shine at all."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Specular IOR Level'].default_value = 0 if flat else specular
    shader.inputs['Coat Weight'].default_value = coat
    shader.inputs['Coat Roughness'].default_value = 0.2
    shader.inputs['Sheen Weight'].default_value = sheen
    shader.inputs['Sheen Roughness'].default_value = 0.45
    if colour is None:
        # Its colour is painted on its vertices.
        attribute = nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        links.new(attribute.outputs['Color'], shader.inputs['Base Color'])
    else:
        shader.inputs['Base Color'].default_value = (*colour, 1)
    if emission:
        shader.inputs['Emission Color'].default_value = (*emission, 1)
        shader.inputs['Emission Strength'].default_value = 1.0
    return mat


# ---------- parts ----------

def plate(shape, body, outline, lift, height, colour):
    """Adds a raised plate lying on the back of `body`, `height` proud of it: `outline` rows are (x of its front edge, x of its rear edge, y), its top a strip between the two edges, walled down to the skin."""
    outline = np.asarray(outline, float)
    n = len(outline)
    tf, tr = body.top(outline[:, 0], outline[:, 2], lift + height), body.top(outline[:, 1], outline[:, 2], lift + height)
    bf, br = body.top(outline[:, 0], outline[:, 2], lift - 0.12), body.top(outline[:, 1], outline[:, 2], lift - 0.12)
    verts = list(tf) + list(tr) + list(bf) + list(br)
    T, R, BF, BR = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n - 1):
        faces += [(T + i, T + i + 1, R + i + 1, R + i), (BF + i, BF + i + 1, T + i + 1, T + i), (R + i, R + i + 1, BR + i + 1, BR + i)]
    faces += [(T, R, BR, BF), (T + n - 1, BF + n - 1, BR + n - 1, R + n - 1)]
    lit, wall = tuple(colour), tuple(np.asarray(colour) * 0.6)
    shape.add(verts, faces, [lit] * (2 * n) + [wall] * (2 * n))


HAIR = np.array((0.60, 0.64, 0.70))  # pale hair
HAIR_DARK = np.array((0.10, 0.11, 0.14))


def fur_prosoma(shape, body):
    """The hair of the carapace: a pale fringe along its margin, a pale stripe down its middle, a thin dark fuzz over the rest, and long forward bristles over the face."""
    margin = lambda x, y: 0.0
    bristles(shape, body, 900, 0.85, 0.026, HAIR * 0.95, lambda x, y: smooth(2.2, 3.2, np.abs(y) / (body.at(x)[0][0]) * 4) * 0.9, lean=(-0.6, 0), up=0.5)
    bristles(shape, body, 1000, 0.75, 0.025, HAIR * 1.15, lambda x, y: np.exp(-((y / 0.95) ** 2)) * smooth(-5, -2, x) * (1 - smooth(5.5, 7.5, x)), lean=(-0.7, 0), up=0.6)
    bristles(shape, body, 500, 0.45, 0.022, HAIR_DARK * 2.4, lambda x, y: 0.5, lean=(-0.5, 0), up=0.7)
    bristles(shape, body, 250, 1.3, 0.038, HAIR * 0.55, lambda x, y: smooth(6.8, 8.6, x), lean=(0.8, 0), up=0.35)
    bristles(shape, body, 520, 0.9, 0.03, HAIR * 1.25, lambda x, y: smooth(7.4, 8.6, x) * smooth(3.4, 1.8, np.abs(y)), lean=(0.9, 0), up=0.3)  # the pale brow and moustache


def fur_abdomen(shape, body):
    """The velvet of the abdomen: a dense short pile, longer and paler along its flanks and toward its tail, with a few long bristles."""
    bristles(shape, body, 1500, 0.45, 0.028, ABDOMEN * 1.6, lambda x, y: 1.0, lean=(-0.6, 0), up=0.8)
    bristles(shape, body, 1900, 0.85, 0.03, HAIR * 1.0, lambda x, y: smooth(2.0, 3.6, np.abs(y)) * 0.95, lean=(-0.7, 0), up=0.55)
    bristles(shape, body, 200, 1.6, 0.038, HAIR_DARK * 3, lambda x, y: smooth(-3, -9, x), lean=(-0.9, 0), up=0.4)


def prosoma(chitin, eye):
    """Head and thorax in one, around the thorax joint: a carapace of plates, the head raised off the thorax by a furrow, radial grooves from the fovea, a lip round its margin, banded pale and dark as a wolf spider is; its eight eyes, the second row's pair large; and under it the hips the legs are hinged on."""
    body = Body([
        (-5.0, 3.4, 1.5, 1.1, PROSOMA_Z - 0.2),
        (-3.2, 5.2, 2.3, 1.5, PROSOMA_Z),
        (-0.6, 5.9, 2.7, 1.7, PROSOMA_Z),
        (2.2, 5.5, 2.8, 1.7, PROSOMA_Z),
        (4.6, 4.5, 3.0, 1.6, PROSOMA_Z),
        (6.6, 3.7, 3.25, 1.5, PROSOMA_Z + 0.1),
        (8.2, 3.2, 3.0, 1.4, PROSOMA_Z + 0.1),
        (9.0, 2.7, 2.3, 1.2, PROSOMA_Z),
    ], power=2.35)
    fovea = -0.8

    def finish(x, y, up):
        back = np.clip(up, 0, 1) ** 0.5
        r = np.hypot(x - fovea, y)
        angle = np.arctan2(np.abs(y), x - fovea)
        furrow = np.clip(sum(np.exp(-(((angle - math.radians(a)) / 0.09) ** 2)) for a in (70, 104, 138)) * smooth(0.9, 2.2, r) * (1 - smooth(4.5, 6.0, r)), 0, 1)
        neck = np.exp(-(((angle - math.radians(34)) / 0.08) ** 2)) * smooth(0.9, 2.2, r) * (1 - smooth(5.5, 8.5, r))
        pit = np.exp(-(((x - fovea) / 1.0) ** 2)) * np.exp(-((y / 0.3) ** 2))
        head = smooth(3.8, 6.2, x) * np.exp(-((y / 2.6) ** 2))
        lip = np.exp(-(((up - 0.2) / 0.07) ** 2))
        grain = mottle(x, y, 7.0, 1.0) - 1.0
        pressed = (0.06 * furrow + 0.08 * neck + 0.16 * pit - 0.06 * head) * back - 0.035 * lip + 0.006 * grain * back
        # Banded: a pale band down the middle, widest behind the eyes; dark bands beside it; a pale band above the margin and a dark line on it.
        band = np.exp(-((y / (0.9 + 1.0 * smooth(-4, 6, x))) ** 4)) * smooth(-5.5, -3.2, x) * (1 - smooth(7.0, 8.4, x))
        side = smooth(0.36, 0.48, up) * (1 - band)
        sub = np.exp(-(((up - 0.3) / 0.09) ** 2))
        margin = np.exp(-(((up - 0.14) / 0.05) ** 2))
        mix = lambda a, b, t: a + (b - a) * np.clip(t, 0, 1)
        shade = mix(mix(mix(mix(1.0, 0.14, side), 2.7, band), 2.0, sub), 0.06, margin)
        shade = shade * (1 - 0.6 * np.clip(furrow + neck + pit, 0, 1) * back) * mottle(x, y, 1.1, 0.12)
        shade *= 0.35 + 0.65 * smooth(-0.6, 0.1, up)
        return pressed, CARAPACE[None, None, :] * shade[:, :, None]

    shape = Shape()
    body.surface(shape, rings=30, around=36, finish=finish)
    fur = Shape()  # the hair, a part of its own: it throws no shadow, which the reader would pay for three times over
    fur_prosoma(fur, body)
    for hip, *_ in LEGS:
        for side in (1, -1):
            lathe(shape, (hip * 0.75, side * 1.7, PROSOMA_Z - 1.3), (hip, side * LEG_HIP, LEG_HIP_HEIGHT), sclerite(0.82, 0.74, 1.05, 0.3, LEG * 0.7, socket=False), 8)

    eyes = Shape()
    # A front row of four small ones low on the face, the large pair above them looking ahead, and a pair behind looking out.
    for x, y, radius, sunk in ((9.05, 0.45, 0.34, 0.45), (8.95, 1.2, 0.3, 0.45), (8.1, 1.0, 0.82, 0.3), (6.8, 1.75, 0.6, 0.35)):
        for side in (1, -1):
            at = body.top(np.array([x]), np.array([side * y]))[0]
            ball(eyes, (at[0], at[1], at[2] - radius * sunk), radius, (0.006, 0.006, 0.008), rings=6, around=14)

    part = bpy.data.objects.new('prosoma', shape.build('prosoma', chitin))
    children = [bpy.data.objects.new('eyes', eyes.build('eyes', eye, smooth=True)), bpy.data.objects.new('fur', fur.build('fur', chitin))]
    for child in children:
        child.parent = part
    return part, children


def chelicera(chitin):
    """A jaw, the left one, around its hinge: the stout base, swollen and banded at its tip, a boss on its outer side, a row of teeth along the furrow the fang closes into, and the fang folded in under it, long and hooked, a part of its own turned on the tip of the jaw so that the reader can open it."""
    shape = Shape()
    z = JAW_Z
    lathe(shape, (0, 0, z), (3.7, 0, z - 1.25), [
        (0.0, 0.7, *(LEG * 0.7)), (0.1, 0.98, *(LEG * 0.95)), (0.42, 1.16, *(LEG * 1.12)), (0.72, 1.0, *(LEG * 0.8)),
        (0.88, 0.8, *(LEG * 0.42)), (1.0, 0.46, *(JOINT * 1.2))], 9, bow=-0.07)
    lathe(shape, (1.2, -0.75, z - 0.3), (1.9, -1.15, z - 0.5), [(0, 0.36, *(LEG * 0.9)), (0.6, 0.33, *(LEG * 1.15)), (1, 0.12, *(LEG * 0.8))], 6)
    furrow_a, furrow_b = np.array((1.6, 0.55, z - 1.0)), np.array((3.4, 0.35, z - 1.55))
    needles(shape, furrow_a, furrow_b, 0.3, [(t, -0.6) for t in (0.15, 0.4, 0.65, 0.9)], 0.55, JOINT * 2.4)
    hinge = np.array((3.6, 0, z - 1.25))
    fang = Shape()
    tube(fang, [(0, 0, 0), (1.2, -0.35, -0.5), (1.95, -1.05, -1.25), (2.15, -1.75, -2.1)], [(0, 0.42), (0.45, 0.27), (1, 0.03)], 9, 6, lambda t: np.column_stack([0.012 + 0.05 * t, 0.011 + 0.01 * t, 0.012 + 0.012 * t]))
    part = bpy.data.objects.new('chelicera', shape.build('chelicera', chitin))
    child = bpy.data.objects.new('fang', fang.build('fang', chitin))
    child.location = hinge * UNIT
    child.parent = part
    return part, [child]


def palp(chitin):
    """A feeler, the left one, from its base at the origin to its tip at (PALP, 0, 0): four banded segments, the last clubbed and dark."""
    shape = Shape()
    limb(shape, [(0, 0, 0), (PALP * 0.3, 0.35, 0.9), (PALP * 0.52, 0.45, 0.95), (PALP * 0.76, 0.25, 0.55), (PALP, 0, 0)],
         [(0.4, 0.44), (0.36, 0.4), (0.34, 0.4), (0.5, 0.24)], [0.8, 0.8, 0.8, 0.3], bows=[0.04, 0, 0, -0.06], swell=1.08)
    return bpy.data.objects.new('palp', shape.build('palp', chitin)), []


def femur(chitin, pair):
    """The upper part of a leg of `pair`, from the hip at the origin to the knee at (its length, 0, 0): the short trochanter it turns on, and the thigh, bowed and thickest above its middle, banded before the knee, with a row of spines along its back; the front pair, which seizes, has a row under it too."""
    length, thick = LEGS[pair][3], LEGS[pair][6]
    shape = Shape()
    (_, _), (start, end) = limb(shape, [(0, 0, 0), (length * 0.1, 0, 0.3), (length, 0, 0)], [(0.62 * thick, 0.82 * thick), (0.86 * thick, 0.5 * thick)], [0.7, 0.95], bows=[0, 0.05], swell=1.2)
    needles(shape, start, end, 0.62 * thick, [(0.22, 1.75), (0.38, 1.25), (0.54, 1.85), (0.7, 1.3), (0.84, 1.7)], 1.7, JOINT * 2.0)
    setae(shape, start, end, 0.62 * thick, 46, 1.3, HAIR * 0.7)
    setae(shape, start, end, 0.62 * thick, 18, 2.0, HAIR_DARK * 3)
    if pair == 0:
        needles(shape, start, end, 0.62 * thick, [(t, -1.25) for t in (0.3, 0.5, 0.7)] + [(t, -1.95) for t in (0.4, 0.6, 0.8)], 2.1, JOINT * 2.2)
    return bpy.data.objects.new(f'femur{pair + 1}', shape.build(f'femur{pair + 1}', chitin)), []


def tibia(chitin, pair):
    """The middle part of a left leg of `pair`, from the knee at the origin to the ankle at (its length, 0, 0): the kneecap, round where the leg bends hardest, and the shin, banded before the ankle, with two rows of spines down its back and, on the front pair, long raking spines under it."""
    length, thick = LEGS[pair][4], LEGS[pair][6]
    shape = Shape()
    segments = limb(shape, [(0, 0, 0), (length * 0.24, 0.15, 0.45), (length, 0, 0)],
                    [(0.56 * thick, 0.52 * thick), (0.5 * thick, 0.4 * thick)], [0.85, 0.9], bows=[0.06, 0.03], swell=1.07)
    start, end = segments[1]
    needles(shape, start, end, 0.45 * thick, [(t, angle) for t in (0.2, 0.45, 0.7) for angle in (0.6, 2.5)], 1.4, JOINT * 2.0)
    setae(shape, start, end, 0.45 * thick, 44, 1.2, HAIR * 0.7)
    setae(shape, start, end, 0.45 * thick, 14, 1.9, HAIR_DARK * 3)
    if pair == 0:
        needles(shape, start, end, 0.45 * thick, [(t, angle) for t in (0.25, 0.5, 0.75) for angle in (-1.15, -2.0)], 2.4, JOINT * 2.2)
    return bpy.data.objects.new(f'tibia{pair + 1}', shape.build(f'tibia{pair + 1}', chitin)), []


def tarsus(chitin, pair):
    """The last part of a left leg of `pair`, from the ankle at the origin to the foot at (its length, 0, 0): the long metatarsus and the tarsus, each bent a little on the last, the tarsus darkest, a dense pad under it and two hooked claws at its tip."""
    length, thick = LEGS[pair][5], LEGS[pair][6]
    shape = Shape()
    segments = limb(shape, [(0, 0, 0), (length * 0.66, 0.1, 0.12), (length, 0, 0)],
                    [(0.36 * thick, 0.27 * thick), (0.24 * thick, 0.12)], [0.85, 0.25], bows=[0.02, -0.03], swell=1.05)
    start, end = segments[0]
    needles(shape, start, end, 0.3 * thick, [(t, angle) for t in (0.25, 0.55, 0.82) for angle in (0.5, 2.6)] + [(0.4, -1.4), (0.75, -1.4)], 1.2, JOINT * 2.0)
    setae(shape, start, end, 0.3 * thick, 30, 0.9, HAIR * 0.7)
    pad_a, pad_b = segments[1]
    setae(shape, pad_a, pad_b, 0.2 * thick, 36, 0.7, HAIR * 0.55, spread=1.9, centre=-math.pi / 2, lean=0.3)
    for out in (-0.12, 0.12):
        tube(shape, [(length - 0.1, out, 0), (length + 0.6, out * 1.7, -0.05), (length + 1.0, out * 2.0, -0.7)], [(0, 0.13), (1, 0.015)], 4, 4, lambda t: np.tile(JOINT * 1.6, (len(t), 1)), closed=(False, True))
    return bpy.data.objects.new(f'tarsus{pair + 1}', shape.build(f'tarsus{pair + 1}', chitin)), []


def abdomen(velvet, mark):
    """The abdomen around its middle, with its spinnerets: an egg cut in facets, a keel down its back, the leaf of the folium raised at its scalloped edge and crossed by grooves; and standing proud of its back the marks the reader lights, the heart mark and the chevrons behind it."""
    half, width, top, bottom, tilt = ABDOMEN_SIZE[0], ABDOMEN_SIZE[1], 4.2, 2.8, 0.08
    stations = []
    for s in -np.cos(np.pi * np.arange(17) / 16):
        full = (1 - abs(s) ** (1.55 if s < 0 else 2.7)) ** 0.5  # blunt at the waist, drawn out to a point at the tail
        stations.append((s * half, width * full * (1 + 0.16 * s), top * full * (1 + 0.1 * s), bottom * full, ABDOMEN_Z + tilt * s * half))
    body = Body(stations, power=2.2, closed=True)
    grooves = [2.2 - i * 2.25 + 1.12 for i in range(MARKS)] + [2.2 + 1.6]

    def edge(x):
        return 2.7 + 0.45 * np.cos((x + 9.2) * 2 * np.pi / 2.2) - 0.11 * np.abs(x + 1) ** 1.4

    def finish(x, y, up):
        back = np.clip(up, 0, 1)
        on = smooth(0.0, 0.35, up)
        dimples = sum(np.exp(-(((x - dx) / 0.5) ** 2) - (((np.abs(y) - dy) / 0.42) ** 2)) for dx, dy in ((4.4, 1.6), (1.6, 2.0)))
        groove = sum(np.exp(-(((x - gx + 0.5 * np.abs(y)) / 0.32) ** 2)) for gx in grooves) * np.exp(-((y / 3.2) ** 2))
        keel = np.exp(-((y / 0.7) ** 2)) * smooth(-8.5, -6.0, x)
        ridge = np.exp(-(((np.abs(y) - edge(x)) / 0.32) ** 2)) * smooth(-9.0, -7.5, x)
        pressed = (0.05 * dimples + 0.045 * groove - 0.035 * keel - 0.04 * ridge) * on
        leaf = smooth(edge(x) + 0.4, edge(x) - 0.4, np.abs(y)) * smooth(-9.4, -8.2, x) * smooth(0.0, 0.3, up)
        flank = smooth(0.75, 0.3, up) * smooth(-0.1, 0.25, up)
        mix = lambda a, b, t: a + (b - a) * np.clip(t, 0, 1)
        shade = mix(mix(mix(1.1, 2.3, flank), 0.16, leaf), 2.8, ridge * on * 0.9) * (1 - 0.55 * np.clip(groove * on + dimples * back, 0, 1)) * mottle(x, y, 0.9, 0.22)
        shade *= 0.35 + 0.65 * smooth(-0.6, 0.1, up)
        return pressed, ABDOMEN[None, None, :] * shade[:, :, None]

    shape = Shape()
    body.surface(shape, rings=52, around=40, finish=finish)
    fur = Shape()
    fur_abdomen(fur, body)
    # The spinnerets, a pair to a side, each side a part of its own turned on the rear of the abdomen, so that the reader can spread them.
    spinnerets = []
    for side in (1, -1):
        pivot = np.array((-8.9, side * 0.55, ABDOMEN_Z - 1.4))
        nubs = Shape()
        for y, z, reach, radius in ((0.7, -1.2, 1.9, 0.42), (0.38, -0.5, 1.3, 0.3)):
            a = np.array((-8.9, side * y, ABDOMEN_Z - 0.7 + z)) - pivot
            lathe(nubs, a, a + np.array((-reach, side * y * 0.25, -0.8)), [(0, radius, *(ABDOMEN * 0.6)), (0.5, radius * 0.9, *(ABDOMEN * 0.8)), (0.8, radius * 0.7, *(ABDOMEN * 0.5)), (1, 0.12, *(JOINT * 1.5))], 6)
        nub = bpy.data.objects.new('spinneret_' + ('L' if side > 0 else 'R'), nubs.build('spinneret', velvet))
        nub.location = pivot * UNIT
        spinnerets.append(nub)
    part = bpy.data.objects.new('abdomen', shape.build('abdomen', velvet))

    children = list(spinnerets) + [bpy.data.objects.new('fur', fur.build('fur', velvet))]
    lift, proud = 0.08, 0.16
    heart = Shape()
    xs = np.linspace(3.6, 7.8, 13)
    halfw = 0.42 * np.sin(np.pi * (xs - 3.6) / 4.2) ** 0.7 + 0.03
    # The heart mark: a lancet along the middle, raised to a ridge and walled down to the skin at its edges.
    n = len(xs)
    top_c = body.top(xs, np.zeros_like(xs), lift + proud * 1.3)
    for sgn in (1, -1):
        e_top = body.top(xs, sgn * halfw, lift + proud)
        e_bot = body.top(xs, sgn * halfw, lift - 0.12)
        verts = list(top_c) + list(e_top) + list(e_bot)
        faces = []
        for i in range(n - 1):
            q = (i, i + 1, n + i + 1, n + i)
            w = (n + i, n + i + 1, 2 * n + i + 1, 2 * n + i)
            faces += [q if sgn > 0 else q[::-1], w if sgn > 0 else w[::-1]]
        heart.add(verts, faces, [tuple(MARK)] * (2 * n) + [tuple(MARK * 0.6)] * n)
    children.append(bpy.data.objects.new('heart', heart.build('heart', mark, recalc=True)))

    # Chevrons, their points forward, each a little smaller than the one before, standing proud of the leaf.
    for i in range(MARKS):
        chevron = Shape()
        x = 2.2 - i * 2.25
        reach = 3.1 - i * 0.3
        ys = np.linspace(0.0, reach, 9)
        w = 0.62 * (1 - 0.65 * ys / reach)
        for side in (1, -1):
            front = x - 0.62 * ys + w / 2
            plate(chevron, body, np.column_stack([front, front - w, side * ys]) if side > 0 else np.column_stack([front - w, front, side * ys]), lift, proud * (1 - 0.4 * i / MARKS), MARK)
        children.append(bpy.data.objects.new(f'chevron{i}', chevron.build(f'chevron{i}', mark, recalc=True)))
    for child in children:
        child.parent = part
    return part, children


# ---------- pose ----------

def along(a, b, mirror=False, length=None):
    """The placing of a part modelled along +X from its joint: at `a`, pointing at `b`, its own up kept as upright as that allows. Stretched to reach `b` if its modelled `length` is given, and `mirror`ed for the right side."""
    a, b = Vector(a), Vector(b)
    x = (b - a).normalized()
    y = Vector((0, 0, 1)).cross(x).normalized()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = a * UNIT
    return m @ Matrix.Diagonal(((b - a).length / length if length else 1, -1 if mirror else 1, 1, 1))


def ankle_of(root, foot, tarsus, pitch=TARSUS_PITCH):
    """Where the ankle of a leg is: up from its foot and back toward its hip, the last part rising `pitch` radians off the page, by the rule src/crawler.js uses."""
    flat = Vector((root.x - foot.x, root.y - foot.y, 0))
    flat = flat.normalized() if flat.length > 1e-6 else Vector((0, 0, 0))
    return foot + flat * math.cos(pitch) * tarsus + Vector((0, 0, math.sin(pitch) * tarsus))


def knee_of(root, ankle, side, upper, lower):
    """Where the knee is between the hip and the ankle, its two parts `upper` and `lower` long: risen, and leaning out by the rule of src/crawler.js."""
    chord = ankle - root
    flat = math.hypot(chord.x, chord.y)
    u = chord.normalized()
    a = (upper**2 - lower**2 + chord.length**2) / (2 * chord.length)
    out = math.sqrt(max(upper**2 - a**2, 0))
    lean = side * (chord.x / flat) * KNEE_SPLAY / flat
    pole = Vector((-chord.y * lean, chord.x * lean, 1))
    pole = (pole - u * pole.dot(u)).normalized()
    return root + u * a + pole * out


def leg_pose(hip, reach_along, reach_out, side, upper, lower, last):
    """Where a leg's hip, knee, ankle and foot are when it stands at rest."""
    root = Vector((hip, side * LEG_HIP, LEG_HIP_HEIGHT))
    foot = Vector((reach_along, side * reach_out, 0))
    ankle = ankle_of(root, foot, last)
    return root, knee_of(root, ankle, side, upper, lower), ankle, foot


def link(collection, part, children, matrix=None):
    for obj in (part, *children):
        collection.objects.link(obj)
    if matrix is not None:
        part.matrix_world = matrix
    return part


def copy(part, children, name):
    """Another of the same part, sharing its mesh."""
    twin = part.copy()
    twin.name = name
    twins = []
    for child in children:
        twin_child = child.copy()
        twin_child.parent = twin
        twins.append(twin_child)
    return twin, twins


def build_crawler(scene):
    chitin = material('chitin', roughness=0.5, coat=0.12, specular=0.28)
    velvet = material('velvet', roughness=0.7, coat=0.0, sheen=0.0, specular=0.22)
    eye = material('eye', roughness=0.04, coat=1.0, colour=(0.004, 0.004, 0.005))
    mark = material('mark', roughness=0.5)

    collection = bpy.data.collections.new('Spidi')
    scene.collection.children.link(collection)
    root = bpy.data.objects.new('spidi', None)
    root.empty_display_size = 0.2
    collection.objects.link(root)
    # What the reader needs to know to place the parts.
    root['unit'] = UNIT
    root['femur'] = [leg[3] for leg in LEGS]
    root['tibia'] = [leg[4] for leg in LEGS]
    root['tarsus'] = [leg[5] for leg in LEGS]
    root['palp'] = PALP
    root['palpZ'] = PALP_Z
    root['abdomen'] = ABDOMEN_SIZE
    root['marks'] = MARKS

    parts = []
    place = lambda made, matrix=None: parts.append(link(collection, *made, matrix))

    place(prosoma(chitin, eye))
    place(abdomen(velvet, mark), Matrix.Translation(Vector((-BELLY - TAIL / 2, 0, 0)) * UNIT))

    for index, (hip, reach_along, reach_out, upper_length, lower_length, last_length, _) in enumerate(LEGS):
        made = femur(chitin, index), tibia(chitin, index), tarsus(chitin, index)
        for side in (1, -1):
            joints = leg_pose(hip, reach_along, reach_out, side, upper_length, lower_length, last_length)
            name = f"{'L' if side > 0 else 'R'}{index + 1}"
            # A leg's shin bows away from the middle of the body's length.
            for (kind, length, mirror), part, a, b in zip((('femur', upper_length, False), ('tibia', lower_length, (side < 0) != (reach_along < 0)), ('tarsus', last_length, (side < 0) != (reach_along < 0))), made, joints, joints[1:]):
                place(copy(*part, f'{kind}_{name}'), along(a, b, mirror, length=length))
        for part in made:
            bpy.data.objects.remove(part[0])

    feeler, jaw = palp(chitin), chelicera(chitin)
    for side in (1, -1):
        name = 'L' if side > 0 else 'R'
        base = (HEAD + 2.5, side * 1.6, PALP_Z[0])
        tip = (HEAD + 12.2, side * 4.6, PALP_Z[1])
        place(copy(*feeler, f'palp_{name}'), along(base, tip, side < 0, length=PALP))
        hinge = Vector((HEAD + 2.2, side * 1.0, 0))
        place(copy(*jaw, f'chelicera_{name}'), along(hinge, hinge + Vector((math.cos(0.22), side * math.sin(0.22), 0)), side < 0))
    for made in (feeler, jaw):
        bpy.data.objects.remove(made[0])

    for part in parts:
        world = part.matrix_world.copy()
        part.parent = root
        part.matrix_world = world
    return collection


# ---------- the rig it is posed by in Blender ----------

def build_rig(collection):
    """An armature the parts ride on, for posing and keying the crawler in Blender: a bone for the thorax and one for the abdomen; for each leg a chain of three, hip to knee to ankle to foot, the first two reaching for the ankle and the last pointed at the foot, so that moving a foot moves the leg by the rule src/crawler.js uses; and a bone for each feeler and jaw. Every part is carried by the bone of its joint."""
    data = bpy.data.armatures.new('rig')
    data.display_type = 'STICK'
    rig = bpy.data.objects.new('rig', data)
    collection.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False):
        made = bones.new(name)
        made.head, made.tail = Vector(head) * UNIT, Vector(tail) * UNIT
        made.parent = bones.get(parent) if parent else None
        made.use_connect = connect
        return made

    bone('root', (0, 0, 0), (0, 0, 2))
    bone('thorax', (0, 0, PROSOMA_Z), (HEAD, 0, PROSOMA_Z), 'root')
    bone('abdomen', (-BELLY + 4, 0, ABDOMEN_Z), (-BELLY - TAIL, 0, ABDOMEN_Z), 'thorax')
    for side in (1, -1):
        s = 'L' if side > 0 else 'R'
        bone(f'palp_{s}', (HEAD + 2.5, side * 1.6, PALP_Z[0]), (HEAD + 12.2, side * 4.6, PALP_Z[1]), 'thorax')
        bone(f'chelicera_{s}', (HEAD + 2.2, side * 1.0, JAW_Z), (HEAD + 2.2 + 3.6, side * 1.8, JAW_Z - 1.2), 'thorax')
    for index, (hip, reach_along, reach_out, upper, lower, last, _) in enumerate(LEGS):
        for side in (1, -1):
            name = f"{'L' if side > 0 else 'R'}{index + 1}"
            root, knee, ankle, foot = leg_pose(hip, reach_along, reach_out, side, upper, lower, last)
            bone(f'femur_{name}', root, knee, 'thorax')
            bone(f'tibia_{name}', knee, ankle, f'femur_{name}', True)
            bone(f'tarsus_{name}', ankle, foot, f'tibia_{name}', True)
            bone(f'foot_{name}', foot, foot + Vector((0, 0, 1.5)), 'root')
            bone(f'ankle_{name}', ankle, ankle + Vector((0, 0, 1.5)), f'foot_{name}')
            # The pole the knee leans toward: above it, out by as much as the rule leans it.
            bone(f'knee_{name}', knee + (knee - (root + ankle) / 2).normalized() * 6, knee + (knee - (root + ankle) / 2).normalized() * 7.5, 'thorax')
    bpy.ops.object.mode_set(mode='OBJECT')

    poses = rig.pose.bones
    for index in range(len(LEGS)):
        for s in 'LR':
            name = f'{s}{index + 1}'
            ik = poses[f'tibia_{name}'].constraints.new('IK')
            ik.target, ik.subtarget, ik.chain_count = rig, f'ankle_{name}', 2
            ik.pole_target, ik.pole_subtarget = rig, f'knee_{name}'
            track = poses[f'tarsus_{name}'].constraints.new('DAMPED_TRACK')
            track.target, track.subtarget = rig, f'foot_{name}'
            for control in ('foot', 'ankle', 'knee'):
                poses[f'{control}_{name}'].custom_shape = None
    # For each leg the pole angle that keeps its knee where it stands at rest: a bone's roll sets it.
    worst = 0
    for bone in [b for b in data.bones if b.name.startswith('femur_')]:
        ik = poses['tibia_' + bone.name[6:]].constraints['IK']
        trials = []
        for degrees in range(-180, 180, 2):
            ik.pole_angle = math.radians(degrees)
            bpy.context.view_layer.update()
            trials.append(((poses[bone.name].tail - bone.tail_local).length, degrees))
        error, degrees = min(trials)
        ik.pole_angle = math.radians(degrees)
        worst = max(worst, error)
    bpy.context.view_layer.update()
    print('rig: worst knee off by', round(worst / UNIT, 3))

    # Each part rides the bone of its joint.
    carried = {'prosoma': 'thorax', 'abdomen': 'abdomen'}
    for obj in list(collection.objects):
        name = obj.name
        if obj.parent and obj.parent.name != 'spidi':
            continue
        bone_name = carried.get(name, name if name in data.bones else None)
        if not bone_name:
            continue
        world = obj.matrix_world.copy()
        obj.parent = rig
        obj.parent_type = 'BONE'
        obj.parent_bone = bone_name
        bpy.context.view_layer.update()
        obj.matrix_world = world
    return rig


# ---------- the scene it is shown in ----------

def aim(obj, toward):
    obj.rotation_euler = Vector(toward).to_track_quat('-Z', 'Y').to_euler()


def build_stage(scene):
    stage = bpy.data.collections.new('Page')
    scene.collection.children.link(stage)

    # The page: near black, with a few lines of its text for scale.
    paper = material('page', roughness=1.0, colour=PAGE, flat=True)
    mesh = bpy.data.meshes.new('page')
    half = 40
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    mesh.materials.append(paper)
    stage.objects.link(bpy.data.objects.new('page', mesh))

    ink = material('ink', roughness=1.0, colour=(0, 0, 0), emission=(0.485, 0.521, 0.584), flat=True)  # #b9bfc9, as on the page whatever the light
    lines = ['which parts of the page are worth keeping, and', 'a crawler that reads it in plain sight. The text', 'is never touched: it walks the lane under a line,', 'and what it keeps it marks and carries off.']
    for i, text in enumerate(lines):
        curve = bpy.data.curves.new(f'line{i}', 'FONT')
        curve.body = text
        curve.size = 19 / SIZE * UNIT  # the page sets its text at 19 px, a line every 32.3
        curve.materials.append(ink)
        line = bpy.data.objects.new(f'line{i}', curve)
        # The crawler stands in the lane under the second line.
        line.location = (-70 * UNIT, (7.3 + (1 - i) * 32.3 / SIZE) * UNIT, 0.002)
        stage.objects.link(line)

    # Lit as the reader lights it: from the top left of the page, with a cold light low on the far side.
    for name, colour, energy, toward, spread in (('Key', (1.0, 0.97, 0.93), 1.7, (0.55, -0.6, -0.75), 12), ('Rim', (0.55, 0.78, 1.0), 1.1, (-0.7, 0.6, -0.3), 25)):
        data = bpy.data.lights.new(name, 'SUN')
        data.color, data.energy, data.angle = colour, energy, math.radians(spread)
        light = bpy.data.objects.new(name, data)
        aim(light, toward)
        light.location = -Vector(toward).normalized() * 12
        stage.objects.link(light)

    world = bpy.data.worlds.new('Dark')
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (0.05, 0.06, 0.08, 1)
    background.inputs['Strength'].default_value = 0.25
    scene.world = world

    # From above, as the reader shows it, and from the side, to see how it stands.
    above = bpy.data.objects.new('Above', bpy.data.cameras.new('Above'))
    above.data.type = 'ORTHO'
    above.data.ortho_scale = 110 * UNIT
    above.location = (0.3, 0, 20)
    side = bpy.data.objects.new('Beside', bpy.data.cameras.new('Beside'))
    side.data.lens = 50
    side.location = (8.5, -10.5, 6.4)
    aim(side, Vector((0.1, 0, 0.3)) - side.location)
    for camera in (above, side):
        stage.objects.link(camera)
    scene.camera = side

    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.view_settings.view_transform = 'Standard'
    return above, side


def export(collection, path):
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.name in collection.objects)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_extras=True, export_cameras=False, export_lights=False, export_animations=False, export_meshopt_compression_enable=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)


def clear():
    """Empties the open file, leaving Blender itself as it is."""
    for kind in ('objects', 'collections', 'meshes', 'curves', 'materials', 'lights', 'cameras', 'worlds', 'images', 'armatures', 'actions'):
        bpy.data.batch_remove(list(getattr(bpy.data, kind)))


SCENE = 'Spidi · beast'  # the scene it is built in, which the open Blender takes in whole (art/show.py)


def main():
    clear()
    scene = bpy.context.scene
    scene.name = SCENE
    collection = build_crawler(scene)
    build_stage(scene)
    export(collection, os.path.join(ROOT, 'assets', 'spidi.glb'))
    build_rig(collection)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'art', 'spidi.blend'))


main()
