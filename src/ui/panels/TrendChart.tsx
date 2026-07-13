"use client";

// 미니 라인 차트 (A=빨강 vs B=파랑) — 다크 패널용, 호버 크로스헤어 + 현재 턴 인디케이터.
// 팔레트는 validate_palette.js로 다크 표면(#17181c) 대비 전항목 PASS 확인됨.

import { useCallback, useRef, useState } from "react";

const W = 248;
const H = 84;
const PAD = { l: 6, r: 6, t: 8, b: 6 };

export interface TrendChartProps {
  title: string;
  a: number[]; // day 인덱스 시리즈 (A)
  b: number[];
  viewDay: number;
  onSeek?: (day: number) => void;
}

function toPath(vals: number[], max: number, len: number): string {
  if (len < 2 || max <= 0) {
    const y = H - PAD.b;
    return `M ${PAD.l} ${y} L ${W - PAD.r} ${y}`;
  }
  const xw = W - PAD.l - PAD.r;
  const yh = H - PAD.t - PAD.b;
  return vals
    .map((v, i) => {
      const x = PAD.l + (i / (len - 1)) * xw;
      const y = H - PAD.b - (v / max) * yh;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function TrendChart({ title, a, b, viewDay, onSeek }: TrendChartProps) {
  const len = Math.max(a.length, b.length);
  const max = Math.max(1, ...a, ...b);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const dayAt = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || len < 2) return 0;
      const frac = (clientX - rect.left) / rect.width;
      const x = frac * W;
      const day = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (len - 1));
      return Math.max(0, Math.min(len - 1, day));
    },
    [len],
  );

  const xw = W - PAD.l - PAD.r;
  const cursorX = (d: number) => PAD.l + (len > 1 ? (d / (len - 1)) * xw : 0);
  const shown = hover ?? Math.min(viewDay, len - 1);

  return (
    <div className="relative">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-zinc-300">{title}</span>
        {hover !== null && (
          <span className="text-[11px] tabular-nums text-chromedim">
            {hover}턴 · <b className="text-nred">{a[hover] ?? 0}</b> vs{" "}
            <b className="text-nblue">{b[hover] ?? 0}</b>
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        className="w-full cursor-crosshair rounded-md bg-chrome"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={(e) => setHover(dayAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSeek?.(dayAt(e.clientX))}
      >
        {/* 은은한 그리드 */}
        {[0.5].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + (H - PAD.t - PAD.b) * f}
            y2={PAD.t + (H - PAD.t - PAD.b) * f}
            stroke="#2c2d34"
            strokeWidth={1}
          />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#3a3b42" strokeWidth={1} />
        {/* y 최대 라벨 */}
        <text x={PAD.l + 1} y={PAD.t + 2} fontSize={8.5} fill="#7c7e88" dominantBaseline="hanging">
          {max}
        </text>
        {/* 시리즈 */}
        <path d={toPath(a, max, len)} fill="none" stroke="var(--color-nred)" strokeWidth={2} strokeLinejoin="round" />
        <path d={toPath(b, max, len)} fill="none" stroke="var(--color-nblue)" strokeWidth={2} strokeLinejoin="round" />
        {/* 현재/호버 인디케이터 */}
        {len > 1 && (
          <g>
            <line x1={cursorX(shown)} x2={cursorX(shown)} y1={PAD.t} y2={H - PAD.b} stroke="#8e90a0" strokeWidth={1} strokeDasharray="3 2" />
            <circle cx={cursorX(shown)} cy={H - PAD.b - ((a[shown] ?? 0) / max) * (H - PAD.t - PAD.b)} r={2.7} fill="var(--color-nred)" stroke="#17181c" strokeWidth={1} />
            <circle cx={cursorX(shown)} cy={H - PAD.b - ((b[shown] ?? 0) / max) * (H - PAD.t - PAD.b)} r={2.7} fill="var(--color-nblue)" stroke="#17181c" strokeWidth={1} />
          </g>
        )}
      </svg>
    </div>
  );
}
