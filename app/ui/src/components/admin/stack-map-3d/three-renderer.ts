import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { readCssColorRgb } from "@crate/ui/lib/read-css-color";
import { FOV } from "./stack-map-3d-camera";
import {
  DOME_HEIGHT,
  GAUGE_MIN,
  GAUGE_RANGE,
  pointAlong,
  type Node3D,
  type Polyline3D,
  type Vec3,
} from "./stack-map-3d-model";
import type { RendererFactory } from "./stack-map-3d-renderer";

const MAX_PARTICLES = 900;
const TRAIL = 4;
const DASHES: Record<string, [number, number] | null> = {
  request: null,
  data: [0.09, 0.045],
  queue: [0.035, 0.045],
  telemetry: [0.014, 0.05],
};

function color(container: HTMLElement, token: `--${string}`, fallback: string) {
  const rgb = readCssColorRgb(container, token);
  return rgb
    ? new Color().setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace)
    : new Color(fallback);
}

function segments(lines: Polyline3D[]) {
  const positions: number[] = [];
  for (const line of lines)
    for (let index = 1; index < line.points.length; index++)
      positions.push(...line.points[index - 1]!, ...line.points[index]!);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function softwareRenderer(renderer: WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  return /swiftshader|llvmpipe|software/i.test(name);
}

const DOME_VERTEX = `
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-view.xyz);
  vHeight = position.y;
  gl_Position = projectionMatrix * view;
}`;
const DOME_FRAGMENT = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uRadius;
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.4);
  float base = 1.0 - smoothstep(0.0, 0.22 * uRadius, vHeight);
  float crown = smoothstep(0.82 * uRadius, uRadius, vHeight) * 0.05;
  float alpha = rim * uStrength + base * 0.05 + crown + 0.016;
  gl_FragColor = vec4(uColor * (0.85 + rim * 0.6), alpha);
}`;
const GROUND_FRAGMENT = `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float r = distance(vUv, vec2(0.5)) * 2.0;
  float glow = (1.0 - smoothstep(0.35, 1.0, r)) * uStrength;
  gl_FragColor = vec4(uColor, glow);
}`;
const GROUND_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const createThreeRenderer: RendererFactory = (
  container,
  scene3d,
  { health, tokens, onContextLost, onQuality },
) => {
  const palette = {
    accent: color(container, "--accent-action-hi", "#67e8f9"),
    muted: color(container, "--text-muted", "#999ca0"),
    primary: color(container, "--text-primary", "#f2f2f5"),
    danger: color(container, "--state-danger-text", "#ef6464"),
    surface: color(container, "--surface-app", "#0a0a0f"),
  };
  const renderer = new WebGLRenderer({ antialias: true });
  const software = softwareRenderer(renderer);
  onQuality(software ? "reduced" : "full");
  renderer.setPixelRatio(
    software ? 0.75 : Math.min(window.devicePixelRatio || 1, 2),
  );
  const canvas = renderer.domElement;
  canvas.className = "stack-map-3d__canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);
  const handleLost = (event: Event) => {
    event.preventDefault();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", handleLost);

  const scene = new Scene();
  scene.background = palette.surface;
  const camera = new PerspectiveCamera((FOV * 180) / Math.PI, 1, 0.1, 200);
  scene.add(new HemisphereLight(0xdfe8ff, 0x16161f, 1.5));
  const key = new DirectionalLight(0xffffff, 2.1);
  key.position.set(4, 9, 6);
  scene.add(key);
  const fill = new DirectionalLight(palette.accent, 0.6);
  fill.position.set(-6, 3, -4);
  scene.add(fill);

  const lineMaterials: LineMaterial[] = [];
  const fatLine = (
    points: Vec3[],
    options: {
      width: number;
      dash: [number, number] | null;
      tint: Color;
      opacity: number;
      fadeTo?: Color;
    },
  ) => {
    const geometry = new LineGeometry();
    geometry.setPositions(points.flat());
    if (options.fadeTo) {
      const fade = new Color();
      geometry.setColors(
        points.flatMap((_, index) => {
          fade
            .copy(options.fadeTo!)
            .lerp(options.tint, index / Math.max(1, points.length - 1));
          return [fade.r, fade.g, fade.b];
        }),
      );
    }
    const material = new LineMaterial({
      color: options.fadeTo ? 0xffffff : options.tint,
      vertexColors: Boolean(options.fadeTo),
      linewidth: options.width,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      dashed: Boolean(options.dash),
      dashSize: options.dash?.[0] ?? 1,
      gapSize: options.dash?.[1] ?? 0,
    });
    lineMaterials.push(material);
    const line = new Line2(geometry, material);
    if (options.dash) line.computeLineDistances();
    scene.add(line);
    return { line, material };
  };
  const thinLines = (lines: Polyline3D[], opacity: number) =>
    scene.add(
      new LineSegments(
        segments(lines),
        new LineBasicMaterial({
          color: palette.muted,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    );

  for (const dome of scene3d.domes) {
    const application = dome.kind === "application";
    const tint = application ? palette.accent : palette.muted;
    const holder = new Group();
    holder.position.set(...dome.center);
    holder.scale.set(1, DOME_HEIGHT, 1);
    const shellUniforms = {
      uColor: { value: tint },
      uStrength: {
        value: application ? tokens.rim.application : tokens.rim.quiet,
      },
      uRadius: { value: dome.radius },
    };
    const sides = software ? [FrontSide] : [BackSide, FrontSide];
    for (const side of sides)
      holder.add(
        new Mesh(
          new SphereGeometry(
            dome.radius,
            software ? 40 : 72,
            software ? 16 : 32,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2,
          ),
          new ShaderMaterial({
            vertexShader: DOME_VERTEX,
            fragmentShader: DOME_FRAGMENT,
            uniforms: {
              ...shellUniforms,
              uStrength: {
                value:
                  shellUniforms.uStrength.value *
                  (side === BackSide ? 0.45 : 1),
              },
            },
            transparent: true,
            depthWrite: false,
            side,
          }),
        ),
      );
    scene.add(holder);
    if (!software) {
      const ground = new Mesh(
        new CircleGeometry(dome.radius + 0.7, 64),
        new ShaderMaterial({
          vertexShader: GROUND_VERTEX,
          fragmentShader: GROUND_FRAGMENT,
          uniforms: {
            uColor: { value: tint },
            uStrength: { value: application ? 0.075 : 0.035 },
          },
          transparent: true,
          depthWrite: false,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(dome.center[0], 0.001, dome.center[2]);
      scene.add(ground);
    }
    const lines = scene3d.lines.filter((line) => line.domeId === dome.id);
    thinLines(
      lines.filter(
        (line) => line.kind === "parallel" || line.kind === "meridian",
      ),
      application ? 0.2 : 0.17,
    );
    thinLines(
      lines.filter((line) => line.kind === "ground" || line.kind === "tick"),
      0.42,
    );
  }

  const coneGeometry = new ConeGeometry(0.036, 0.11, 14);
  const up = new Vector3(0, 1, 0);
  type EdgeState = "active" | "live" | "rest" | "telemetry" | "muted";
  const EDGE_STYLE: Record<
    EdgeState,
    { width: number; opacity: number; accent: boolean }
  > = {
    active: { width: tokens.lines.active, opacity: 0.95, accent: true },
    live: { width: tokens.lines.live, opacity: 0.72, accent: true },
    rest: { width: tokens.lines.rest, opacity: 0.42, accent: false },
    telemetry: { width: tokens.lines.quiet, opacity: 0.24, accent: false },
    muted: { width: tokens.lines.quiet, opacity: 0.08, accent: false },
  };
  const trimmed = scene3d.edges.map((edge) => {
    const stride = software ? 4 : 1;
    const points = edge.points.filter(
      (_, index) =>
        edge.lengths[index]! <= edge.arrowAt * edge.total &&
        (index % stride === 0 || index === edge.points.length - 1),
    );
    points.push(pointAlong(edge, edge.arrowAt));
    return points;
  });
  const arrows = new InstancedMesh(
    coneGeometry,
    new MeshBasicMaterial({ color: 0xffffff }),
    Math.max(1, scene3d.edges.length),
  );
  scene3d.edges.forEach((edge, index) => {
    const at = pointAlong(edge, edge.arrowAt);
    const ahead = pointAlong(edge, Math.min(1, edge.arrowAt + 0.02));
    const behind = pointAlong(edge, Math.max(0, edge.arrowAt - 0.02));
    const orientation = new Quaternion().setFromUnitVectors(
      up,
      new Vector3(
        ahead[0] - behind[0],
        ahead[1] - behind[1],
        ahead[2] - behind[2],
      ).normalize(),
    );
    arrows.setMatrixAt(
      index,
      new Matrix4().compose(
        new Vector3(...at),
        orientation,
        new Vector3(1, 1, 1),
      ),
    );
  });
  arrows.count = scene3d.edges.length;
  scene.add(arrows);
  let edgeSignature = "";
  let edgeGroups: (LineSegments2 | LineSegments)[] = [];
  const edgeColor = new Color();
  const rebuildEdges = (states: EdgeState[]) => {
    const signature = states.join(",");
    if (signature === edgeSignature) return;
    edgeSignature = signature;
    for (const group of edgeGroups) {
      scene.remove(group);
      group.geometry.dispose();
      const material = group.material as Material;
      material.dispose();
      const index = lineMaterials.indexOf(material as LineMaterial);
      if (index >= 0) lineMaterials.splice(index, 1);
    }
    edgeGroups = [];
    const buckets = new Map<string, number[]>();
    scene3d.edges.forEach((edge, index) => {
      const key = `${states[index]}|${edge.connection.kind}`;
      const list = buckets.get(key) ?? [];
      const points = trimmed[index]!;
      for (let step = 1; step < points.length; step++)
        list.push(...points[step - 1]!, ...points[step]!);
      buckets.set(key, list);
      const style = EDGE_STYLE[states[index]!];
      edgeColor
        .copy(palette.surface)
        .lerp(
          style.accent ? palette.accent : palette.muted,
          Math.min(1, style.opacity * 1.3),
        );
      arrows.setColorAt(index, edgeColor);
    });
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
    for (const [key, positions] of buckets) {
      const [state, kind] = key.split("|") as [EdgeState, string];
      const style = EDGE_STYLE[state];
      const dash = DASHES[kind] ?? null;
      if (software && !style.accent) {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          "position",
          new Float32BufferAttribute(positions, 3),
        );
        const thin = new LineSegments(
          geometry,
          dash
            ? new LineDashedMaterial({
                color: palette.muted,
                dashSize: dash[0],
                gapSize: dash[1],
                transparent: true,
                opacity: Math.min(1, style.opacity * 1.4),
                depthWrite: false,
              })
            : new LineBasicMaterial({
                color: palette.muted,
                transparent: true,
                opacity: Math.min(1, style.opacity * 1.4),
                depthWrite: false,
              }),
        );
        if (dash) thin.computeLineDistances();
        scene.add(thin);
        edgeGroups.push(thin);
        continue;
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color: style.accent ? palette.accent : palette.muted,
        linewidth: style.width,
        transparent: true,
        opacity: style.opacity,
        depthWrite: false,
        dashed: Boolean(dash),
        dashSize: dash?.[0] ?? 1,
        gapSize: dash?.[1] ?? 0,
      });
      material.resolution.set(width || 1, height || 1);
      lineMaterials.push(material);
      const group = new LineSegments2(geometry, material);
      if (dash) group.computeLineDistances();
      scene.add(group);
      edgeGroups.push(group);
    }
  };

  for (const beam of scene3d.beams)
    fatLine(beam.edge.points, {
      width: tokens.lines.live,
      dash: null,
      tint: palette.accent,
      opacity: 0.8,
      fadeTo: palette.surface,
    });

  interface NodeVisual {
    node: Node3D;
    body: Mesh<SphereGeometry, MeshStandardMaterial>;
    halo: InstancedMesh;
    haloIndex: number;
  }
  const visuals: NodeVisual[] = [];
  const dashedRing = mergeGeometries(
    Array.from(
      { length: 10 },
      (_, arc) =>
        new RingGeometry(1, 1.14, 6, 1, (arc / 10) * Math.PI * 2, Math.PI / 10),
    ),
  );
  const haloKinds = {
    healthy: new InstancedMesh(
      new RingGeometry(1, 1.1, 48),
      new MeshBasicMaterial({ side: DoubleSide }),
      scene3d.nodes.size,
    ),
    unhealthy: new InstancedMesh(
      new RingGeometry(1, 1.26, 48),
      new MeshBasicMaterial({ side: DoubleSide }),
      scene3d.nodes.size,
    ),
    unknown: new InstancedMesh(
      dashedRing,
      new MeshBasicMaterial({ side: DoubleSide }),
      scene3d.nodes.size,
    ),
  };
  const haloCounts = { healthy: 0, unhealthy: 0, unknown: 0 };
  const gaugeGeometry = new CylinderGeometry(0.014, 0.014, 1, 10, 1);
  gaugeGeometry.translate(0, 0.5, 0);
  const gauges = new InstancedMesh(
    gaugeGeometry,
    new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      transparent: true,
      opacity: 0.9,
    }),
    scene3d.nodes.size,
  );
  let gaugeCount = 0;
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scaleVector = new Vector3();
  const position = new Vector3();
  for (const [id, node] of scene3d.nodes) {
    const state = health.get(id) ?? "unknown";
    const body = new Mesh(
      new SphereGeometry(node.size, software ? 16 : 32, software ? 12 : 20),
      new MeshStandardMaterial({
        color: palette.primary,
        roughness: 0.32,
        metalness: 0.12,
        transparent: true,
      }),
    );
    body.position.set(...node.position);
    scene.add(body);
    const halo = haloKinds[state];
    visuals.push({ node, body, halo, haloIndex: haloCounts[state]++ });
    if (node.load !== null && node.ring !== "hub") {
      position
        .set(...node.position)
        .addScaledVector(new Vector3(...node.normal), node.size + 0.012);
      quaternion.setFromUnitVectors(up, new Vector3(...node.normal));
      scaleVector.set(1, GAUGE_MIN + GAUGE_RANGE * node.load, 1);
      matrix.compose(position, quaternion, scaleVector);
      gauges.setMatrixAt(gaugeCount, matrix);
      gaugeCount += 1;
    }
  }
  for (const [state, mesh] of Object.entries(haloKinds)) {
    mesh.count = haloCounts[state as keyof typeof haloCounts];
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  gauges.count = gaugeCount;
  gauges.instanceMatrix.needsUpdate = true;
  scene.add(gauges);

  const levelMeshes = new Map<
    string,
    { mesh: Mesh<RingGeometry, MeshBasicMaterial>; value: number }
  >();
  const particles = new InstancedMesh(
    new SphereGeometry(0.026, 10, 8),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    MAX_PARTICLES,
  );
  particles.count = 0;
  particles.frustumCulled = false;
  scene.add(particles);
  const tint = new Color();
  const identity = new Quaternion();

  const composer =
    software || !tokens.bloom ? null : new EffectComposer(renderer);
  const bloom =
    composer && tokens.bloom
      ? new UnrealBloomPass(
          new Vector2(256, 256),
          tokens.bloom.strength,
          tokens.bloom.radius,
          tokens.bloom.threshold,
        )
      : null;
  if (composer && bloom) {
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  let width = 0;
  let height = 0;
  const toCamera = new Vector3();

  const removeLevel = (id: string) => {
    const entry = levelMeshes.get(id);
    if (!entry) return;
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    levelMeshes.delete(id);
  };

  return {
    render({
      projection,
      camera: state,
      highlight,
      dots,
      levels,
      levelsPaused,
    }) {
      if (projection.width !== width || projection.height !== height) {
        width = projection.width;
        height = projection.height;
        renderer.setSize(width, height, false);
        composer?.setSize(width, height);
        bloom?.resolution.set(width / 2, height / 2);
        for (const material of lineMaterials)
          material.resolution.set(width, height);
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      }
      camera.position.set(...projection.eye);
      camera.up.set(...projection.up);
      camera.lookAt(...state.target);

      rebuildEdges(
        scene3d.edges.map((edge) => {
          const active = highlight.active.has(edge.connection);
          if (active) return "active";
          if (highlight.previewing) return "muted";
          if (highlight.live.has(edge.connection)) return "live";
          return edge.crossStack && edge.connection.kind === "telemetry"
            ? "telemetry"
            : "rest";
        }),
      );

      for (const { node, body, halo, haloIndex } of visuals) {
        const id = node.service.id;
        const state = health.get(id) ?? "unknown";
        const selected = highlight.selectedId === id;
        const hovered = highlight.hoveredId === id;
        const active = highlight.activeIds.has(id);
        const dimmed = highlight.previewing && !active;
        toCamera.set(
          projection.eye[0] - node.position[0],
          projection.eye[1] - node.position[1],
          projection.eye[2] - node.position[2],
        );
        const back =
          node.ring !== "hub" &&
          node.normal[0] * toCamera.x +
            node.normal[1] * toCamera.y +
            node.normal[2] * toCamera.z <
            0;
        const material = body.material;
        material.color.copy(
          selected
            ? palette.accent
            : state === "unhealthy"
              ? palette.danger
              : active
                ? palette.primary
                : palette.muted,
        );
        const hub =
          node.ring === "hub" &&
          scene3d.domes.find((dome) => dome.id === node.domeId)?.kind ===
            "application";
        material.emissive.copy(
          selected || hub
            ? palette.accent
            : state === "unhealthy"
              ? palette.danger
              : palette.primary,
        );
        material.emissiveIntensity = selected
          ? 0.85
          : state === "unhealthy"
            ? 0.8
            : hub
              ? 0.4
              : hovered
                ? 0.35
                : 0.05;
        material.opacity = dimmed ? 0.35 : back ? 0.6 : 1;
        const grow = selected ? 1.25 : hovered ? 1.15 : 1;
        body.scale.setScalar(grow);
        position.set(...node.position);
        scaleVector.setScalar((node.size + 0.035) * grow);
        matrix.compose(position, camera.quaternion, scaleVector);
        halo.setMatrixAt(haloIndex, matrix);
        tint
          .copy(palette.surface)
          .lerp(
            selected
              ? palette.accent
              : state === "unhealthy"
                ? palette.danger
                : palette.muted,
            (selected || state === "unhealthy"
              ? 0.95
              : state === "unknown"
                ? 0.6
                : 0.38) * (back ? 0.6 : 1),
          );
        halo.setColorAt(haloIndex, tint);
      }
      for (const mesh of Object.values(haloKinds)) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }

      for (const id of [...levelMeshes.keys()])
        if ((levels.get(id) ?? 0) <= 0) removeLevel(id);
      for (const [id, value] of levels) {
        const node = scene3d.nodes.get(id);
        if (!node || value <= 0) continue;
        let entry = levelMeshes.get(id);
        if (!entry || Math.abs(entry.value - value) > 1e-3) {
          removeLevel(id);
          const radius = node.size + 0.075;
          const mesh = new Mesh(
            new RingGeometry(
              radius,
              radius + 0.016,
              64,
              1,
              Math.PI / 2,
              -Math.max(0.04, value) * Math.PI * 2,
            ),
            new MeshBasicMaterial({
              color: palette.accent,
              transparent: true,
              side: DoubleSide,
              depthWrite: false,
            }),
          );
          mesh.position.set(...node.position);
          scene.add(mesh);
          entry = { mesh, value };
          levelMeshes.set(id, entry);
        }
        entry.mesh.quaternion.copy(camera.quaternion);
        entry.mesh.material.opacity = levelsPaused ? 0.2 : 0.7;
      }

      let count = 0;
      const place = (
        point: Vec3,
        size: number,
        hue: Color,
        strength: number,
      ) => {
        if (count >= MAX_PARTICLES) return;
        position.set(...point);
        scaleVector.setScalar(size);
        matrix.compose(position, identity, scaleVector);
        particles.setMatrixAt(count, matrix);
        particles.setColorAt(count, tint.copy(hue).multiplyScalar(strength));
        count += 1;
      };
      for (const dot of dots) {
        const hue = dot.error
          ? palette.danger
          : dot.beam
            ? palette.primary
            : palette.accent;
        place(dot.position, dot.beam ? 0.8 : 1, hue, dot.opacity * 1.4);
        for (let step = 1; step <= TRAIL; step++) {
          const t = dot.travelled + (dot.reverse ? 1 : -1) * step * 0.022;
          if (t < 0 || t > 1) break;
          place(
            pointAlong(dot.edge, t),
            1 - step * 0.17,
            hue,
            dot.opacity * (1 - step / (TRAIL + 1)) * 0.9,
          );
        }
      }
      particles.count = count;
      particles.instanceMatrix.needsUpdate = true;
      if (particles.instanceColor) particles.instanceColor.needsUpdate = true;

      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLost);
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      composer?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
};

export default createThreeRenderer;
