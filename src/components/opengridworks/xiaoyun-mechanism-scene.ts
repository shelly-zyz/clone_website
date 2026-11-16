import {
  AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, TorusGeometry, Vector3, WebGLRenderer,
  type BufferGeometry, type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Mechanism } from "@/lib/xiaoyun/anatomy";

type Shape = Mechanism["parts"][number]["shape"];
export type MechanismControls = {
  focus: (step: number) => void;
  rotate: (direction: number) => void;
  reset: () => void;
  dispose: () => void;
};

export function mountMechanism(canvas: HTMLCanvasElement, shapes: readonly Shape[]): MechanismControls {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color("#eef3f7");
  const camera = new OrthographicCamera(-5, 5, 3, -3, 0.1, 80);
  camera.position.set(6, 6, 10);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.8, 0);
  controls.enablePan = false;
  controls.minZoom = 0.6;
  controls.maxZoom = 3;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.update();
  controls.saveState();

  const keyLight = new DirectionalLight("#fff5e9", 3);
  keyLight.position.set(-3, 7, 5);
  const fill = new DirectionalLight("#bfddff", 1.9);
  fill.position.set(5, 4, -6);
  scene.add(new AmbientLight("#dae8ff", 1.35), keyLight, fill);

  const steel = new MeshStandardMaterial({ color: "#8398ad", metalness: 0.35, roughness: 0.44 });
  const dark = new MeshStandardMaterial({ color: "#24394e", metalness: 0.2, roughness: 0.54 });
  const copper = new MeshStandardMaterial({ color: "#ae6334", metalness: 0.45, roughness: 0.42 });
  const inactive = new Color("#4e718b");
  const active = new Color("#087f86");

  function part(parent: Group | Scene, geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0) {
    const object = new Mesh(geometry, material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }

  function box(parent: Group | Scene, material: Material, size: [number, number, number], at: [number, number, number]) {
    return part(parent, new BoxGeometry(...size), material, ...at);
  }

  function cylinder(parent: Group, material: Material, radius: number, height: number, x: number, y: number, z: number) {
    return part(parent, new CylinderGeometry(radius, radius, height, 24), material, x, y, z);
  }

  box(scene, dark, [shapes.length * 2.1, 0.22, 2.15], [0, -0.16, 0]);
  box(scene, steel, [shapes.length * 2.1 - 0.12, 0.045, 2.04], [0, -0.026, 0]);
  const modules = shapes.map((shape, index) => {
    const group = new Group();
    group.position.x = (index - (shapes.length - 1) / 2) * 2.1;
    scene.add(group);
    const finish = new MeshStandardMaterial({ color: inactive, metalness: 0.2, roughness: 0.48 });
    box(group, finish, [1.76, 0.14, 1.62], [0, 0.07, 0]);
    for (const x of [-0.7, 0.7]) {
      for (const z of [-0.62, 0.62]) cylinder(group, steel, 0.045, 0.04, x, 0.15, z);
    }

    const body = new Group();
    group.add(body);
    let moving: Group | undefined;
    switch (shape) {
      case "rotor":
      case "gear": {
        box(body, steel, [0.26, 1.1, 0.27], [0, 0.68, -0.22]);
        moving = new Group();
        moving.position.set(0, 1.21, 0.02);
        group.add(moving);
        cylinder(moving, finish, shape === "gear" ? 0.54 : 0.17, 0.16, 0, 0, 0).rotation.x = Math.PI / 2;
        cylinder(moving, steel, 0.12, 0.22, 0, 0, 0.025).rotation.x = Math.PI / 2;
        const count = shape === "gear" ? 14 : 3;
        for (let i = 0; i < count; i++) {
          const angle = i * Math.PI * 2 / count;
          const radius = shape === "gear" ? 0.55 : 0.4;
          box(moving, finish, shape === "gear" ? [0.18, 0.15, 0.13] : [0.62, 0.16, 0.074],
            [radius * Math.cos(angle), radius * Math.sin(angle), 0]).rotation.z = angle;
        }
        break;
      }
      case "coil":
        for (const x of [-0.51, 0.51]) {
          box(body, finish, [0.2, 1.22, 0.76], [x, 0.77, 0]);
          cylinder(body, steel, 0.19, 0.21, x * 1.33, 0.85, 0).rotation.z = Math.PI / 2;
        }
        for (let i = 0; i < 9; i++) {
          part(body, new TorusGeometry(0.37, 0.038, 9, 28), copper, (i - 4) * 0.1, 0.85, 0).rotation.y = Math.PI / 2;
        }
        break;
      case "tank":
        cylinder(body, finish, 0.52, 0.94, 0, 0.7, 0);
        for (const y of [0.24, 0.47, 0.96, 1.18]) cylinder(body, steel, 0.54, 0.045, 0, y, 0);
        cylinder(body, dark, 0.14, 0.19, 0, 1.28, 0);
        break;
      case "panel": {
        for (const x of [-0.5, 0.5]) box(body, steel, [0.09, 0.64, 0.08], [x, 0.46, 0]);
        const panel = new Group();
        panel.position.y = 0.81;
        panel.rotation.x = -0.53;
        group.add(panel);
        box(panel, steel, [1.47, 0.98, 0.065], [0, 0, 0]);
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 4; j++) box(panel, finish, [0.21, 0.2, 0.025], [(i - 2.5) * 0.23, (j - 1.5) * 0.23, 0.047]);
        }
        break;
      }
      case "filter":
        for (const z of [-0.3, 0.3]) box(body, finish, [1.25, 1.22, 0.1], [0, 0.75, z]);
        for (let i = 0; i < 8; i++) box(body, steel, [1.06, 0.055, 0.5], [0, 0.25 + i * 0.135, 0]);
        break;
      case "switch":
        for (const x of [-0.38, 0.38]) {
          cylinder(body, dark, 0.23, 0.57, x, 0.42, 0);
          for (const y of [0.3, 0.43, 0.55]) cylinder(body, finish, 0.275, 0.05, x, y, 0);
          cylinder(body, copper, 0.12, 0.1, x, 0.74, 0);
        }
        box(body, copper, [0.74, 0.085, 0.13], [-0.075, 0.96, 0]).rotation.z = 0.58;
        break;
      case "cabinet":
        box(body, finish, [1.12, 1.25, 0.78], [0, 0.77, 0]);
        box(body, dark, [0.48, 0.23, 0.055], [-0.09, 1.12, 0.405]);
        for (let i = 0; i < 5; i++) box(body, steel, [0.76, 0.033, 0.045], [0, 0.38 + i * 0.086, 0.412]);
        box(body, copper, [0.04, 0.23, 0.065], [0.43, 0.91, 0.407]);
        break;
    }
    return { finish, moving };
  });

  let selected = 0;
  const focus = (step: number) => {
    selected = step;
    modules.forEach(({ finish }, index) => finish.color.copy(index === step ? active : inactive));
  };
  focus(0);
  const resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    const aspect = width / height;
    const size = Math.max(3, (shapes.length * 1.12 + 0.15) / aspect);
    camera.left = -size * aspect;
    camera.right = size * aspect;
    camera.top = size;
    camera.bottom = -size;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  });
  resize.observe(canvas);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let previous = performance.now();
  function draw(now: number) {
    const moving = modules[selected]?.moving;
    if (moving && !reducedMotion.matches) moving.rotation.z += Math.min(now - previous, 48) * 0.00125;
    previous = now;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  const up = new Vector3(0, 1, 0);
  return {
    focus,
    rotate(direction) {
      camera.position.sub(controls.target).applyAxisAngle(up, direction * Math.PI / 12).add(controls.target);
      controls.update();
    },
    reset() { controls.reset(); },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      const materials = new Set<Material>();
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        materials.add(object.material);
      });
      materials.forEach(material => material.dispose());
      renderer.dispose();
    },
  };
}
