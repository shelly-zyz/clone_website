"use client";

import { useEffect, useRef } from "react";
import { economyName, tradeRegions, type TradeFlow } from "@/lib/carbon-trade";
import styles from "./CarbonTradeWorkspace.module.css";

const center = 300;
const gap = 0.043;
const ring = 245;
const inner = 216;
const turn = 2 * Math.PI;
const step = (turn - gap * tradeRegions.length) / tradeRegions.reduce((sum, region) => sum + region.members.split(" ").length, 0);
const nodes = new Map<string, { start: number; end: number; angle: number; color: string }>();
let cursor = -Math.PI / 2 + gap / 2;
const groups = tradeRegions.map(region => {
  const start = cursor;
  for (const code of region.members.split(" ")) {
    nodes.set(code, { start: cursor, end: cursor + step, angle: cursor + step / 2, color: region.color });
    cursor += step;
  }
  const end = cursor;
  cursor += gap;
  return { ...region, start, end };
});

function point(angle: number, radius: number) {
  return [center + Math.cos(angle) * radius, center + Math.sin(angle) * radius] as const;
}

function arc(start: number, end: number, radius: number) {
  return `M ${point(start, radius).join(" ")} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end, radius).join(" ")}`;
}

export function CarbonTradeChord({ flows, maximum, selected, focus, peer, onFocus, onChoose }: {
  flows: TradeFlow[];
  maximum: number;
  selected: string;
  focus: string;
  peer: string;
  onFocus: (id: string) => void;
  onChoose: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linked = new Set(flows.flatMap(([from, to]) => [from, to]));
  const active = focus || (selected !== "W" ? selected : "");
  const peers = new Set(flows.flatMap(([from, to]) => from === selected ? [to] : to === selected ? [from] : []));

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    type Ribbon = { from: number[]; c1: number[]; c2: number[]; to: number[]; weight: number; color: string; end: string; lit: boolean };
    const ribbons: Ribbon[] = [];
    for (const [from, to, mt] of flows.slice().reverse()) {
      const source = nodes.get(from);
      const target = nodes.get(to);
      if (!source || !target) continue;
      const distance = Math.abs(Math.sin((source.angle - target.angle) / 2));
      const pull = Math.max(36, inner * (0.88 - distance * 0.76));
      const lit = !active || ((from === active || to === active) && (!peer || from === peer || to === peer));
      ribbons.push({
        from: [...point(source.angle + step * 0.13, inner)], c1: [...point(source.angle, pull)],
        c2: [...point(target.angle, pull)], to: [...point(target.angle - step * 0.13, inner)],
        weight: Math.sqrt(mt / Math.max(1, maximum)), lit,
        color: active && to === active ? "#63d8ff" : active && from === active ? "#bf96ff" : source.color,
        end: active ? (to === active ? "#63d8ff" : from === active ? "#bf96ff" : target.color) : target.color,
      });
    }
    const bezier = ({ from, c1, c2, to }: Ribbon, t: number) => {
      const u = 1 - t;
      return [0, 1].map(k => u * u * u * from[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * to[k]);
    };
    // Static ribbons are painted once; the animation only composites them and moves particles.
    const layer = document.createElement("canvas");
    layer.width = layer.height = 1200;
    const paint = layer.getContext("2d");
    if (!paint) return;
    paint.setTransform(2, 0, 0, 2, 0, 0);
    paint.globalCompositeOperation = "lighter";
    for (const ribbon of ribbons) {
      const { from, c1, c2, to, weight, color, end, lit } = ribbon;
      if (lit) {
        const gradient = paint.createLinearGradient(from[0], from[1], to[0], to[1]);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.45, color);
        gradient.addColorStop(1, end);
        paint.strokeStyle = gradient;
      } else paint.strokeStyle = color;
      paint.globalAlpha = lit ? active ? 0.3 + weight * 0.5 : 0.1 + weight * 0.4 : 0.03;
      paint.lineWidth = 0.34 + weight * (active ? 3.5 : 2.65);
      paint.beginPath();
      paint.moveTo(from[0], from[1]);
      paint.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], to[0], to[1]);
      paint.stroke();
      if (active && lit) {
        const angle = Math.atan2(to[1] - c2[1], to[0] - c2[0]);
        const head = 2.7 + weight * 3.8;
        paint.fillStyle = end;
        paint.beginPath();
        paint.moveTo(to[0], to[1]);
        paint.lineTo(to[0] - head * Math.cos(angle - 0.53), to[1] - head * Math.sin(angle - 0.53));
        paint.lineTo(to[0] - head * Math.cos(angle + 0.53), to[1] - head * Math.sin(angle + 0.53));
        paint.fill();
      }
    }
    // Particles travel exporter → importer on the strongest lit flows; count and size follow volume.
    const movers = ribbons.filter(ribbon => ribbon.lit).sort((a, b) => b.weight - a.weight).slice(0, active ? 60 : 140)
      .flatMap(ribbon => Array.from({ length: 1 + Math.round(ribbon.weight * 3) }, (_, i) => ({
        ribbon, phase: (i * 0.37 + ribbon.weight * 5.3) % 1, speed: 0.12 + 0.1 * (1 - ribbon.weight),
      })));
    const glow = document.createElement("canvas");
    glow.width = glow.height = 32;
    const sprite = glow.getContext("2d");
    if (sprite) {
      const halo = sprite.createRadialGradient(16, 16, 0, 16, 16, 16);
      halo.addColorStop(0, "rgba(255,255,255,1)");
      halo.addColorStop(0.25, "rgba(220,240,255,.75)");
      halo.addColorStop(1, "rgba(160,200,255,0)");
      sprite.fillStyle = halo;
      sprite.fillRect(0, 0, 32, 32);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = (now - started) / 1000;
      const reveal = reduced ? 1 : Math.min(1, elapsed / 0.8);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, 1200, 1200);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1 - (1 - reveal) ** 3;
      context.drawImage(layer, 0, 0);
      if (!reduced) {
        context.setTransform(2, 0, 0, 2, 0, 0);
        context.globalCompositeOperation = "lighter";
        for (const { ribbon, phase, speed } of movers) {
          const t = (phase + elapsed * speed) % 1;
          const [x, y] = bezier(ribbon, t);
          const size = 3 + ribbon.weight * 7;
          context.globalAlpha = reveal * Math.sin(Math.PI * t) * (0.45 + ribbon.weight * 0.55);
          context.drawImage(glow, x - size / 2, y - size / 2, size, size);
        }
        frame = requestAnimationFrame(draw);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, flows, maximum, peer]);

  return <div className={styles.diagram} aria-label="隐含碳贸易弦图">
    <canvas ref={canvasRef} width={1200} height={1200} aria-hidden="true" />
    <svg viewBox="0 0 600 600" aria-label="经济体圆环" onPointerLeave={() => onFocus("")}>
      <defs>
        <radialGradient id="carbon-core">
          <stop offset="0" stopColor="#5bb8ff" stopOpacity=".22" />
          <stop offset=".55" stopColor="#3a6bd6" stopOpacity=".08" />
          <stop offset="1" stopColor="#3a6bd6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="carbon-orbit" x1="0" x2="1">
          <stop offset="0" stopColor="#9be365" stopOpacity="0" />
          <stop offset=".5" stopColor="#9be365" stopOpacity=".9" />
          <stop offset="1" stopColor="#63d8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={inner} fill="url(#carbon-core)" className={styles.core} aria-hidden="true" />
      <g className={styles.orbit} aria-hidden="true">
        <circle cx={center} cy={center} r={ring + 22} fill="none" stroke="#7fa6d8" strokeOpacity=".16" strokeDasharray="1 7" />
        <path d={arc(-0.9, 0.35, ring + 22)} fill="none" stroke="url(#carbon-orbit)" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <g className={styles.orbitReverse} aria-hidden="true">
        <path d={arc(2.2, 3.1, inner - 30)} fill="none" stroke="#63d8ff" strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" />
      </g>
      {groups.map(({ label, color, start, end }) => {
        const [x, y] = point((start + end) / 2, 273);
        return <g key={label} aria-hidden="true">
          <path d={arc(start, end, ring + 5)} stroke={color} strokeWidth="2" fill="none" opacity=".84" />
          <text x={x} y={y} className={styles.regionLabel}>{label}</text>
        </g>;
      })}
      {[...nodes].map(([code, { start, end, angle, color }]) => {
        const emphasized = code === active || code === peer;
        const visible = selected === "W" || code === selected || peers.has(code);
        const [x, y] = point(angle, inner - 17);
        return <g key={code} role="button" tabIndex={visible ? 0 : -1}
          aria-label={economyName(code)} aria-pressed={code === selected} className={styles.node}
          onPointerEnter={() => onFocus(code)} onPointerLeave={() => onFocus("")} onFocus={() => onFocus(code)} onBlur={() => onFocus("")}
          onClick={() => onChoose(code)}
          onKeyDown={event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onChoose(code);
          }}>
          <path d={arc(start + 0.003, end - 0.003, ring - 14)} fill="none" stroke={color} strokeWidth="34"
            opacity={emphasized ? .5 : visible ? .12 : .038} />
          <path d={arc(start + 0.0035, end - 0.0035, inner + 3)} fill="none"
            stroke={emphasized ? "#e3f9ff" : color} strokeWidth={emphasized ? 6 : 4}
            opacity={visible && linked.has(code) ? .93 : .29} />
          {emphasized && <text x={x} y={y} className={styles.nodeLabel}>{code}</text>}
          <path d={arc(start, end, ring - 15)} fill="none" stroke="transparent" strokeWidth="36" />
        </g>;
      })}
    </svg>
  </div>;
}
