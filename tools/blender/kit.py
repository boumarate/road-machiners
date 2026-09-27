"""Shared helpers for the Blender asset scripts in this folder.

Each asset script builds one model from primitives through a Kit, then calls Kit.export().
Units are meters, Z is up, and the model's front faces +X. Blender +X/+Y/+Z export as
glTF +X/-Z/+Y, so the front stays +X in Three.js.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector

Vec3 = tuple[float, float, float]

# Direction from the target to the game camera, from OFFSET in src/three/render/camera.ts.
# Three.js (x, y, z) is Blender (x, -z, y).
GAME_VIEW = Vector((1.0, -1.0, 0.816)).normalized()
PREVIEW_PX = (900, 700)

# One truck deck cell in meters, matching PHYSICS.cell in src/data/physics.ts.
CELL_ACROSS = 0.484  # Blender Y
CELL_ALONG = 0.65  # Blender X


@dataclass(frozen=True)
class Args:
    out: Path
    preview: Path | None


def parse_args() -> Args:
    """Reads the arguments after Blender's `--` separator."""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="blender --background --python <script.py> --")
    parser.add_argument("out", type=Path, help="path of the .glb to write")
    parser.add_argument("preview", type=Path, nargs="?", help="optional preview .png from the game camera angle")
    ns = parser.parse_args(argv)
    return Args(out=ns.out, preview=ns.preview)


def linear(hex_color: int) -> tuple[float, float, float, float]:
    """Converts an sRGB palette hex value to the linear RGBA that Blender and glTF store."""

    def channel(c: int) -> float:
        v = c / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (channel(hex_color >> 16 & 255), channel(hex_color >> 8 & 255), channel(hex_color & 255), 1.0)


class Kit:
    """Builds one model in an empty scene and exports it.

    colors maps material names to sRGB hex values from src/render/palette.ts.
    seed fixes the random dents and scatter, so the exported model is reproducible.
    """

    def __init__(self, colors: Mapping[str, int], seed: int) -> None:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.rng = random.Random(seed)
        self._parts: list[bpy.types.Object] = []
        self._sockets: list[bpy.types.Object] = []
        self._materials = {name: _material(name, hex_color) for name, hex_color in colors.items()}

    def dent(self, obj: bpy.types.Object, amount: float) -> None:
        """Pushes each vertex up to `amount` meters in a random direction, so flat panels read as battered."""
        for v in obj.data.vertices:
            v.co += Vector((self.rng.uniform(-1, 1), self.rng.uniform(-1, 1), self.rng.uniform(-1, 1))) * amount

    def box(self, name: str, size: Vec3, loc: Vec3, mat: str, rot: Vec3 = (0, 0, 0), dent_by: float = 0.0) -> bpy.types.Object:
        """Adds a box. size is the full extent per axis. Mesh coordinates stay local to loc."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        obj = bpy.context.object
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return self._add(obj, name, mat, dent_by)

    def cylinder(
        self,
        name: str,
        radius: float,
        depth: float,
        loc: Vec3,
        mat: str,
        rot: Vec3 = (0, 0, 0),
        vertices: int = 10,
        dent_by: float = 0.0,
    ) -> bpy.types.Object:
        """Adds a cylinder with its axis along local Z before rot. Low vertex counts keep the faceted look."""
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
        return self._add(bpy.context.object, name, mat, dent_by)

    def socket(self, name: str, loc: Vec3) -> None:
        """Adds an empty named socket_<name> at loc, where another model attaches. models.ts reads and removes it."""
        full = f"socket_{name}"
        if any(s.name == full for s in self._sockets):
            raise ValueError(f"socket {full} is already defined")
        empty = bpy.data.objects.new(full, None)
        empty.location = loc
        bpy.context.scene.collection.objects.link(empty)
        self._sockets.append(empty)

    def export(self, name: str, args: Args, view_size: float) -> None:
        """Joins all parts into one flat-shaded mesh, writes the .glb with the sockets, and renders the preview if asked.

        The origin stays at the world origin, which is the model's ground point.
        view_size is the preview's width in meters.
        """
        if not self._parts:
            raise RuntimeError(f"{name} has no parts to export")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in self._parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = self._parts[0]
        bpy.ops.object.join()
        model = bpy.context.object
        model.name = name
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for poly in model.data.polygons:
            poly.use_smooth = False
        for empty in self._sockets:
            empty.select_set(True)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(args.out), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
        print(f"wrote {args.out}: {len(model.data.polygons)} faces")
        if args.preview:
            _render_preview(args.preview, view_size)

    def _add(self, obj: bpy.types.Object, name: str, mat: str, dent_by: float) -> bpy.types.Object:
        if mat not in self._materials:
            raise KeyError(f"{name} uses unknown material {mat!r}. Known: {sorted(self._materials)}")
        obj.name = name
        if dent_by:
            self.dent(obj, dent_by)
        obj.data.materials.append(self._materials[mat])
        self._parts.append(obj)
        return obj


def _material(name: str, hex_color: int) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = linear(hex_color)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = 1.0
    return mat


def _render_preview(path: Path, view_size: float) -> None:
    """Renders an orthographic view from the game camera's direction."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = PREVIEW_PX
    scene.render.filepath = str(path)
    target = Vector((0, 0, view_size * 0.08))
    bpy.ops.object.camera_add(location=target + GAME_VIEW * view_size * 2)
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = view_size
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    bpy.ops.render.render(write_still=True)
    print(f"wrote {path}")
