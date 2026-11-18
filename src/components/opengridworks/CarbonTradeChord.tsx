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
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.clearRect(0, 0, 600, 600);
    context.globalCompositeOperation = "lighter";
    const draw = (flow: TradeFlow, highlighted: boolean) => {
      const [from, to, mt] = flow;
      const source = nodes.get(from);
      const target = nodes.get(to);
      if (!source || !target) return;
      const [x1, y1] = point(source.angle + step * 0.13, inner);
      const [x2, y2] = point(target.angle - step * 0.13, inner);
      const distance = Math.abs(Math.sin((source.angle - target.angle) / 2));
      const pull = Math.max(36, inner * (0.88 - distance * 0.76));
      const [a, b] = point(source.angle, pull);
      const [c, d] = point(target.angle, pull);
      const weight = Math.sqrt(mt / Math.max(1, maximum));
      const color = active && to === active ? "#63d8ff" : active && from === active ? "#bf96ff" : source.color;
      if (highlighted) {
        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.45, color);
        gradient.addColorStop(1, active ? color : target.color);
        context.strokeStyle = gradient;
      } else {
        context.strokeStyle = source.color;
      }
      context.globalAlpha = highlighted ? active ? 0.34 + weight * 0.56 : 0.12 + weight * 0.44 : 0.034;
      context.lineWidth = 0.34 + weight * (active ? 3.5 : 2.65);
      context.beginPath();
      context.moveTo(x1, y1);
      context.bezierCurveTo(a, b, c, d, x2, y2);
      context.stroke();
      if (active && highlighted) {
        const angle = Math.atan2(y2 - d, x2 - c);
        const head = 2.7 + weight * 3.8;
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(x2, y2);
        context.lineTo(x2 - head * Math.cos(angle - 0.53), y2 - head * Math.sin(angle - 0.53));
        context.lineTo(x2 - head * Math.cos(angle + 0.53), y2 - head * Math.sin(angle + 0.53));
        context.fill();
      }
    };
    for (const flow of flows.slice().reverse()) {
      const [from, to] = flow;
      const highlighted = !active || ((from === active || to === active) && (!peer || from === peer || to === peer));
      draw(flow, highlighted);
    }
  }, [active, flows, maximum, peer]);

  return <div className={styles.diagram} aria-label="隐含碳贸易弦图">
    <canvas ref={canvasRef} width={1200} height={1200} aria-hidden="true" />
    <svg viewBox="0 0 600 600" aria-label="经济体圆环" onPointerLeave={() => onFocus("")}>
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
