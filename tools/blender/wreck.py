# Burnt pickup wreck for the 'wreck' obstacle.
# Run: blender --background --python tools/blender/wreck.py -- <out.glb> [preview.png]
# Units are meters, nose along +X, sized for the 0.7-tile reference wreck (2.8 m radius).
# Blender +X/+Y/+Z export as glTF +X/-Z/+Y, so the nose stays +X in Three.js.

import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
if not args:
    raise SystemExit("usage: blender --background --python wreck.py -- <out.glb> [preview.png]")
OUT = args[0]
PREVIEW = args[1] if len(args) > 1 else None

rng = random.Random(7)  # fixed, so the exported model is reproducible

# Colors from src/render/palette.ts.
RUST_TOP = 0x8A4A2A
RUST_SIDE = 0x5E3420
RUST_DARK = 0x3A2418
WHEEL = 0x2A2420
METAL = 0x4A4744
SOOT = 0x1E1A18


def linear(hex_color):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (ch(hex_color >> 16 & 255), ch(hex_color >> 8 & 255), ch(hex_color & 255), 1.0)


def material(name, hex_color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = linear(hex_color)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = 1.0
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
MAT = {
    "rust": material("rust", RUST_TOP),
    "rust_side": material("rust_side", RUST_SIDE),
    "rust_dark": material("rust_dark", RUST_DARK),
    "wheel": material("wheel", WHEEL),
    "metal": material("metal", METAL),
    "soot": material("soot", SOOT),
}
parts = []


def dent(obj, amount):
    # Pushes each vertex a little in a random direction, so flat panels read as battered.
    for v in obj.data.vertices:
        v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * amount


def box(name, size, loc, mat, rot=(0, 0, 0), dent_by=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if dent_by:
        dent(o, dent_by)
    o.data.materials.append(MAT[mat])
    parts.append(o)
    return o


def wheel(name, loc, rot, radius=0.42, width=0.3, flat=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=width, location=loc, rotation=rot)
    tire = bpy.context.object
    tire.name = name
    tire.data.materials.append(MAT["wheel"])
    if flat:
        # A flat tire: squash the vertices on the ground side.
        for v in tire.data.vertices:
            if v.co.y < -radius * 0.5:
                v.co.y = -radius * 0.5 - (v.co.y + radius * 0.5) * (1 - flat)
    parts.append(tire)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius * 0.45, depth=width * 1.1, location=loc, rotation=rot)
    hub = bpy.context.object
    hub.name = name + "_hub"
    hub.data.materials.append(MAT["metal"])
    parts.append(hub)


def cut_top(obj, keep_below):
    # Shears the top of a mesh down to a slanted plane, for the crushed cab roof. Coordinates are mesh-local.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        limit = keep_below(v.co.x, v.co.y)
        if v.co.z > limit:
            v.co.z = limit
    bm.to_mesh(obj.data)
    bm.free()


# Ladder frame, sagging at the rear.
for side in (-0.55, 0.55):
    box("rail", (4.6, 0.14, 0.18), (0.0, side, 0.42), "metal", rot=(0, math.radians(-2), 0))
box("crossmember_front", (0.14, 1.2, 0.14), (1.9, 0, 0.42), "metal")
box("crossmember_rear", (0.14, 1.2, 0.14), (-1.9, 0, 0.36), "metal")

# Bed: floor, two walls, one wall torn off and lying on the ground.
box("bed_floor", (2.1, 1.7, 0.08), (-1.2, 0, 0.62), "rust_dark", dent_by=0.03)
box("bed_wall_left", (2.1, 0.07, 0.5), (-1.2, -0.84, 0.9), "rust", dent_by=0.05)
box("bed_wall_front", (0.07, 1.7, 0.5), (-0.17, 0, 0.9), "rust", dent_by=0.04)
box("bed_tailgate", (0.06, 1.6, 0.42), (-2.3, 0, 0.58), "rust_side", rot=(0, math.radians(62), 0), dent_by=0.04)
box("bed_wall_torn", (1.9, 0.06, 0.48), (-1.1, 1.55, 0.05), "rust_side", rot=(math.radians(84), 0, math.radians(14)), dent_by=0.05)

# Cab: body with the roof crushed toward the passenger side, soot-black window holes.
cab = box("cab", (1.1, 1.72, 1.0), (0.4, 0, 1.1), "rust", dent_by=0.04)
cut_top(cab, lambda x, y: 0.3 - y * 0.3 - x * 0.1)
cab.rotation_euler = (math.radians(-5), 0, 0)
box("windshield_hole", (0.05, 1.4, 0.34), (0.96, 0, 1.33), "soot", rot=(0, math.radians(-25), 0))
box("side_window_left", (0.7, 0.05, 0.3), (0.42, -0.87, 1.3), "soot")
box("side_window_right", (0.7, 0.05, 0.26), (0.42, 0.85, 1.25), "soot")

# Hood popped open on its hinge, engine block showing.
box("engine", (0.8, 0.9, 0.45), (1.45, 0, 0.78), "soot", dent_by=0.03)
box("hood", (1.05, 1.66, 0.06), (1.3, 0, 1.28), "rust", rot=(0, math.radians(-32), 0), dent_by=0.04)
box("fender_left", (1.1, 0.12, 0.35), (1.45, -0.82, 0.78), "rust_side", dent_by=0.04)
box("fender_right", (1.0, 0.12, 0.3), (1.5, 0.84, 0.72), "rust_dark", rot=(math.radians(-12), 0, 0), dent_by=0.04)
box("bumper", (0.12, 1.9, 0.18), (2.05, 0.05, 0.5), "metal", rot=(0, 0, math.radians(8)), dent_by=0.02)

# Three wheels left, one flat. The fourth lies loose on the ground.
AXLE = (math.radians(90), 0, 0)
wheel("wheel_fl", (1.45, -0.95, 0.42), AXLE)
wheel("wheel_rl", (-1.35, -0.95, 0.42), AXLE)
wheel("wheel_rr", (-1.35, 0.95, 0.33), AXLE, flat=0.6)
wheel("wheel_loose", (2.2, 1.5, 0.15), (0, 0, 0))

# Scrap panels scattered around.
for i in range(3):
    a = rng.uniform(0, math.tau)
    d = rng.uniform(2.0, 2.5)
    box(f"scrap{i}", (rng.uniform(0.3, 0.6), rng.uniform(0.2, 0.4), 0.04), (math.cos(a) * d, math.sin(a) * d, 0.03), "rust_dark",
        rot=(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), a), dent_by=0.02)

# One mesh, flat-shaded, origin on the ground.
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
wreck = bpy.context.object
wreck.name = "wreck"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for p in wreck.data.polygons:
    p.use_smooth = False

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
print(f"wrote {OUT}: {len(wreck.data.polygons)} faces")

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.filepath = PREVIEW
    bpy.ops.object.camera_add(location=(7, -7, 7))
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 7
    cam.rotation_euler = (Vector((0, 0, 0.6)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    bpy.ops.render.render(write_still=True)
    print(f"wrote {PREVIEW}")
