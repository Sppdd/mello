"""Build Tolo, Mello's tortoise mascot, as a stylized 3D character.

Follows the brief in docs/brand/weavy-tortoise-pipeline.md: chunky rounded
shapes, thick dark plum outline, one flat shadow tone, the gold "streak gem"
hexagon on top of the shell and a two-leaf sprout on the head.

Run inside Blender (MCP execute_blender_code) or headless:
    Blender --background --python build_tolo.py
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.getcwd()

PALETTE = {
    "shell": "#14B8A6",      # lagoon teal
    "pattern": "#0F766E",    # deep teal
    "skin": "#FFB37A",       # apricot
    "belly": "#FFF4E0",      # cream
    "ink": "#2B1B3D",        # dark plum
    "gem": "#FFC93C",        # sunflower
    "bg": "#FFF9F0",         # warm cream
    "cheek": "#FF8A6B",
    "leaf": "#7BD389",
    "floor": "#F3E6D2",
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_code):
    h = hex_code.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def shade(hex_code, k=0.78):
    """The one flat shadow tone: the base colour darkened and nudged toward plum."""
    r, g, b, a = rgba(hex_code)
    pr, pg, pb, _ = rgba(PALETTE["ink"])
    return (r * k + pr * 0.06, g * k + pg * 0.06, b * k + pb * 0.12, 1.0)


# ---------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    scene.view_settings.view_transform = "Standard"  # keep the brand hex codes exact
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1600
    scene.render.film_transparent = False

    world = bpy.data.worlds.new("Mello cream")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    bg.inputs["Color"].default_value = rgba(PALETTE["bg"])
    # Cream behind the character, but only a dim fill on it so the toon shadow reads
    fill = nt.nodes.new("ShaderNodeBackground")
    fill.inputs["Color"].default_value = rgba(PALETTE["bg"])
    fill.inputs["Strength"].default_value = 0.15
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(fill.outputs["Background"], mix.inputs[1])
    nt.links.new(bg.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], nt.nodes["World Output"].inputs["Surface"])
    scene.world = world
    return scene


# ---------------------------------------------------------------- materials

def toon_material(name, hex_code, threshold=0.45, glow=0.0):
    """Diffuse -> Shader to RGB -> constant ramp: lit colour plus one flat shadow tone."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
    to_rgb = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    emit = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")

    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = shade(hex_code)
    ramp.color_ramp.elements[1].position = threshold
    ramp.color_ramp.elements[1].color = rgba(hex_code)
    emit.inputs["Strength"].default_value = 1.0 + glow

    nt.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    nt.links.new(to_rgb.outputs["Color"], bw.inputs["Color"])
    nt.links.new(bw.outputs["Val"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    mat.diffuse_color = rgba(hex_code)
    return mat


def flat_material(name, hex_code, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = rgba(hex_code)
    emit.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    mat.diffuse_color = rgba(hex_code)
    return mat


def outline_material():
    mat = flat_material("Outline plum", PALETTE["ink"])
    mat.use_backface_culling = True
    # The hull wraps each part, so it must not cast shadows onto what it outlines
    nt = mat.node_tree
    emit = nt.nodes["Emission"]
    out = nt.nodes["Material Output"]
    path = nt.nodes.new("ShaderNodeLightPath")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    nt.links.new(emit.outputs["Emission"], mix.inputs[1])
    nt.links.new(clear.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


# ---------------------------------------------------------------- helpers

def add_outline(obj, thickness, mat_outline):
    """Inverted-hull outline: a flipped solidify shell that only shows its back faces."""
    obj.data.materials.append(mat_outline)
    mod = obj.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(obj.data.materials) - 1


def sphere(name, loc, scale, mat, segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def parent_to(children, parent):
    bpy.context.view_layer.update()
    for c in children:
        mw = c.matrix_world.copy()
        c.parent = parent
        c.matrix_world = mw


def hex_plate(name, shell, direction, radius, mat, thickness=0.07):
    """A hexagon scute that hugs the shell: a subdivided hex shrinkwrapped onto the dome."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=6, radius=radius)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    center = Vector(shell["center"])
    s = Vector(shell["scale"])
    d = Vector(direction).normalized()
    surface = center + Vector((d.x * s.x, d.y * s.y, d.z * s.z))
    normal = Vector((d.x / s.x, d.y / s.y, d.z / s.z)).normalized()
    obj.location = surface + normal * 0.05
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = normal.to_track_quat("Z", "Y")

    shrink = obj.modifiers.new("Hug shell", "SHRINKWRAP")
    shrink.target = shell["obj"]
    shrink.wrap_method = "NEAREST_SURFACEPOINT"
    solid = obj.modifiers.new("Thickness", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = 1.0
    bevel = obj.modifiers.new("Soft edge", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 3
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(mat)
    return obj


def curve_tube(name, points, depth, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = depth
    curve.bevel_resolution = 6
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, co in zip(spline.bezier_points, points):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def on_head(head_c, head_r, dx, dz, lift=0.0):
    """Point on the front (-Y) of the head sphere."""
    y = head_c[1] - math.sqrt(max(head_r ** 2 - dx ** 2 - dz ** 2, 0.0)) - lift
    return Vector((head_c[0] + dx, y, head_c[2] + dz))


# ---------------------------------------------------------------- Tolo

def build_tolo():
    m = {
        "shell": toon_material("Shell lagoon teal", PALETTE["shell"]),
        "pattern": toon_material("Shell deep teal", PALETTE["pattern"]),
        "skin": toon_material("Skin apricot", PALETTE["skin"]),
        "belly": toon_material("Belly cream", PALETTE["belly"], threshold=0.35),
        "gem": toon_material("Streak gem", PALETTE["gem"], threshold=0.3),
        "cheek": flat_material("Cheek", PALETTE["cheek"]),
        "ink": flat_material("Ink plum", PALETTE["ink"]),
        "white": flat_material("Eye highlight", "#FFFFFF", strength=1.2),
        "leaf": toon_material("Sprout leaf", PALETTE["leaf"]),
        "floor": flat_material("Floor shadow", PALETTE["floor"]),
    }
    ol = outline_material()

    root = bpy.data.objects.new("Tolo", None)
    bpy.context.collection.objects.link(root)
    parts = []

    # Shell dome (deep teal base, lagoon scutes on top so the gaps read as pattern)
    shell_c, shell_s = (0.0, 0.2, 0.62), (1.05, 1.12, 0.82)
    shell = sphere("Shell", shell_c, shell_s, m["pattern"], segments=64, rings=40)
    add_outline(shell, 0.045, ol)
    shell_info = {"obj": shell, "center": shell_c, "scale": shell_s}
    parts.append(shell)

    plates = [hex_plate("Scute gem", shell_info, (0, 0, 1), 0.3, m["gem"], thickness=0.09)]
    for i in range(6):
        a = math.radians(60 * i + 30)
        pol = math.radians(40)
        d = (math.sin(pol) * math.cos(a), math.sin(pol) * math.sin(a), math.cos(pol))
        plates.append(hex_plate(f"Scute ring1 {i}", shell_info, d, 0.27, m["shell"]))
    for i in range(12):
        a = math.radians(30 * i)
        pol = math.radians(70)
        d = (math.sin(pol) * math.cos(a), math.sin(pol) * math.sin(a), math.cos(pol))
        plates.append(hex_plate(f"Scute ring2 {i}", shell_info, d, 0.21, m["shell"], thickness=0.05))
    parts += plates

    # Rim and cream plastron peeking out underneath
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.09, location=(0, 0.2, 0.38),
                                     major_segments=72, minor_segments=24)
    rim = bpy.context.active_object
    rim.name = "Shell rim"
    rim.scale = (1.07, 1.13, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    rim.data.materials.append(m["shell"])
    add_outline(rim, 0.035, ol)
    parts.append(rim)

    belly = sphere("Plastron", (0, 0.15, 0.3), (0.98, 1.05, 0.28), m["belly"])
    add_outline(belly, 0.035, ol)
    parts.append(belly)

    # Stubby legs with cream toes
    for side in (-1, 1):
        for front, y in ((True, -0.55), (False, 0.95)):
            leg = sphere(f"Leg {'F' if front else 'B'}{'L' if side < 0 else 'R'}",
                         (side * 0.72, y, 0.2), (0.27, 0.27, 0.3), m["skin"])
            add_outline(leg, 0.035, ol)
            parts.append(leg)
            if front:
                for t in (-1, 0, 1):
                    toe = sphere("Toe", (side * 0.72 + t * 0.1, y - 0.25, 0.06), (0.055, 0.05, 0.045),
                                 m["belly"], segments=16, rings=10)
                    parts.append(toe)

    tail = sphere("Tail", (0, 1.3, 0.32), (0.11, 0.22, 0.1), m["skin"], segments=24, rings=16)
    tail.rotation_euler = (math.radians(-20), 0, 0)
    add_outline(tail, 0.03, ol)
    parts.append(tail)

    # Neck and the big chibi head
    neck = sphere("Neck", (0, -0.8, 0.72), (0.3, 0.38, 0.34), m["skin"])
    add_outline(neck, 0.035, ol)
    parts.append(neck)

    head_c, head_r = (0.0, -1.05, 1.28), 0.62
    head = sphere("Head", head_c, (head_r, head_r * 0.95, head_r * 0.92), m["skin"], segments=64, rings=40)
    add_outline(head, 0.05, ol)
    parts.append(head)
    hr = head_r * 0.95  # front radius for placing face features

    # Eyes: big glossy plum with a white highlight
    for side in (-1, 1):
        p = on_head(head_c, hr, side * 0.23, 0.06, lift=-0.06)
        eye = sphere(f"Eye {'L' if side < 0 else 'R'}", p, (0.115, 0.07, 0.14), m["ink"])
        parts.append(eye)
        hl = sphere("Eye highlight", p + Vector((side * -0.03 - 0.0, -0.06, 0.05)),
                    (0.04, 0.02, 0.045), m["white"], segments=16, rings=10)
        parts.append(hl)
        hl2 = sphere("Eye glint", p + Vector((side * 0.035, -0.06, -0.06)),
                     (0.017, 0.01, 0.017), m["white"], segments=12, rings=8)
        parts.append(hl2)
        cheek = sphere(f"Cheek {'L' if side < 0 else 'R'}", on_head(head_c, hr, side * 0.38, -0.16, lift=-0.04),
                       (0.12, 0.04, 0.08), m["cheek"], segments=24, rings=12)
        parts.append(cheek)

    # Smile
    smile_pts = [on_head(head_c, hr, dx, dz, lift=0.005) for dx, dz in ((-0.11, -0.13), (0, -0.2), (0.11, -0.13))]
    smile = curve_tube("Smile", smile_pts, 0.022, m["ink"])
    parts.append(smile)

    # Two-leaf sprout on top of the head
    top = Vector((0, head_c[1] + 0.05, head_c[2] + head_r * 0.92))
    stem = curve_tube("Sprout stem", [top - Vector((0, 0, 0.05)), top + Vector((0.02, 0, 0.12)),
                                      top + Vector((0, 0, 0.22))], 0.025, m["leaf"])
    parts.append(stem)
    for side in (-1, 1):
        leaf = sphere("Sprout leaf", top + Vector((side * 0.12, 0, 0.27)), (0.14, 0.05, 0.07), m["leaf"],
                      segments=32, rings=16)
        leaf.rotation_euler = (0, math.radians(side * -25), 0)
        add_outline(leaf, 0.022, ol)
        parts.append(leaf)

    parent_to(parts, root)

    # Soft contact shadow on the floor
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=1.0, fill_type="NGON", location=(0, 0.15, 0.002))
    floor = bpy.context.active_object
    floor.name = "Floor shadow"
    floor.scale = (1.55, 1.75, 1)
    floor.data.materials.append(m["floor"])
    return root


def add_light_and_cameras():
    sun = bpy.data.objects.new("Key sun", bpy.data.lights.new("Key sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(8)
    # Key light from the upper front-left
    sun.rotation_euler = Vector((4.0, 6.0, -7.0)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun)

    target = bpy.data.objects.new("Camera target", None)
    target.location = (0, -0.2, 0.75)
    bpy.context.collection.objects.link(target)

    cams = {}
    for name, loc in (("Cam front", (0, -9.5, 2.6)), ("Cam three-quarter", (-6.2, -7.4, 3.2))):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        cam.data.lens = 85
        cam.location = loc
        track = cam.constraints.new("TRACK_TO")
        track.target = target
        bpy.context.collection.objects.link(cam)
        cams[name] = cam
    return cams


def main():
    scene = reset_scene()
    build_tolo()
    cams = add_light_and_cameras()
    for name, file in (("Cam three-quarter", "tolo-3q.png"), ("Cam front", "tolo-front.png")):
        scene.camera = cams[name]
        scene.render.filepath = os.path.join(OUT_DIR, file)
        bpy.ops.render.render(write_still=True)
    scene.camera = cams["Cam three-quarter"]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "tolo.blend"))


main()
