"use client";

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight, DirectionalLight, Group, PerspectiveCamera, Scene,
  WebGLRenderer, type BufferGeometry, type Material, type Object3D, type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import styles from "./WeatherVolume.module.css";

type RenderState = { group: Group; render: () => void };

function dispose(group: Group) {
  const geometries = new Set<BufferGeometry>();
  const surfaces = new Set<Material>();
  const textures = new Set<Texture>();
  group.traverse(object => {
    const item = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (item.geometry) geometries.add(item.geometry);
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : [];
    for (const material of materials) {
      surfaces.add(material);
      if ("map" in material && material.map) textures.add(material.map as Texture);
    }
  });
  textures.forEach(texture => texture.dispose());
  surfaces.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

export function WeatherVolumeCanvas({ build, label, width }: { build: () => Group; label: string; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<RenderState | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let webgl: WebGLRenderer;
    try {
      webgl = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      queueMicrotask(() => setError(true));
      return;
    }
    const camera = new PerspectiveCamera(39, 1, 1, width * 16);
    camera.position.set(width * 1.12, width * .94, width * 1.47);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, width * .06, 0);
    controls.enablePan = false;
    controls.minDistance = width * .65;
    controls.maxDistance = width * 4;
    controls.minPolarAngle = .08;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.update();

    const scene = new Scene();
    const group = new Group();
    scene.add(group, new AmbientLight("#bed9f8", 2.0));
    const key = new DirectionalLight("#fff3d8", 2);
    key.position.set(-width / 2, width, width);
    scene.add(key);
    const render = () => webgl.render(scene, camera);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      webgl.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
      webgl.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const lost = () => setError(true);
    controls.addEventListener("change", render);
    canvas.addEventListener("webglcontextlost", lost);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    renderer.current = { group, render };
    resize();
    return () => {
      renderer.current = null;
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      dispose(group);
      webgl.dispose();
    };
  }, [attempt, width]);

  useEffect(() => {
    const current = renderer.current;
    if (!current) return;
    const content = build();
    current.group.add(content);
    current.render();
    return () => {
      current.group.remove(content);
      dispose(content);
    };
  }, [attempt, build, width]);

  return (
    <>
      <canvas className={styles.volumeCanvas} ref={ref} role="img" aria-label={label} />
      {error && <p role="alert" className={styles.notice}>当前浏览器无法绘制三维画面。
        <button onClick={() => { setError(false); setAttempt(value => value + 1); }}>重试</button></p>}
    </>
  );
}

export function useWeatherArchive<T>(path: string, validate: (value: T) => boolean) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Weather archive unavailable");
      const result: T = await response.json();
      if (!validate(result)) throw new Error("Weather archive has an unexpected schema");
      if (!controller.signal.aborted) setData(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt, path, validate]);
  return { data, error, retry: () => { setError(false); setAttempt(value => value + 1); } };
}

export const unpack = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
