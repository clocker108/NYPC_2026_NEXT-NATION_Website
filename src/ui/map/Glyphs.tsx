"use client";

// 공용 SVG 글리프 — MapView(베이스 렌더)와 TurnAnimationLayer(연출 클론)가 같은 마크업을
// 공유해서, 연출이 끝나고 실제 렌더로 바뀔 때 픽셀 단위로 이어진다.

import type { SVGProps } from "react";
import type { Side } from "@/engine/types";

// 연출용 data-* 어트리뷰트를 객체 리터럴로 넘길 수 있게 허용
type DataProps = { [key: `data-${string}`]: string | number | undefined };

export function WarriorChip({
  x,
  y,
  side,
  count,
  groupProps,
  countProps,
}: {
  x?: number; // x·y 생략 시 groupProps의 style transform 등으로 직접 배치 (연출용)
  y?: number;
  side: Side;
  count: number | string;
  groupProps?: SVGProps<SVGGElement> & DataProps;
  countProps?: SVGProps<SVGTextElement> & DataProps;
}) {
  const color = side === 0 ? "var(--color-nred)" : "var(--color-nblue)";
  return (
    <g transform={x !== undefined && y !== undefined ? `translate(${x},${y})` : undefined} {...groupProps}>
      <circle cx={0} cy={-160} r={110} fill={color} />
      <path d="M -140 200 Q -140 -40 0 -40 Q 140 -40 140 200 Z" fill={color} />
      <text
        x={190}
        y={140}
        fontSize={340}
        fontWeight={700}
        fill="#222"
        stroke="#f6f2e6"
        strokeWidth={70}
        paintOrder="stroke"
        {...countProps}
      >
        {count}
      </text>
    </g>
  );
}

export function BuildingGlyph({
  x,
  y,
  side,
  kind,
  level,
  hp,
  maxHp,
  levelFrom,
}: {
  x: number;
  y: number;
  side: Side;
  kind: "HQ" | "BASE";
  level: number;
  hp: number;
  maxHp: number;
  levelFrom?: number; // 지정 시 레벨 뱃지가 연출 카운트업 대상(data-anim='lvl')이 된다
}) {
  const color = side === 0 ? "var(--color-nreddark)" : "var(--color-nbluedark)";
  const light = side === 0 ? "var(--color-nred)" : "var(--color-nblue)";
  const w = kind === "HQ" ? 900 : 750;
  const h = kind === "HQ" ? 620 : 500;
  const hpFrac = Math.max(0, Math.min(1, hp / maxHp));
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-h} width={w} height={h} rx={60} fill={color} stroke="#2b2b2b" strokeWidth={30} />
      <rect x={-w / 2} y={-h - 110} width={w * 0.26} height={130} fill={color} />
      <rect x={-w * 0.13} y={-h - 110} width={w * 0.26} height={130} fill={color} />
      <rect x={w / 2 - w * 0.26} y={-h - 110} width={w * 0.26} height={130} fill={color} />
      <rect x={-w * 0.14} y={-h * 0.55} width={w * 0.28} height={h * 0.55} rx={40} fill="#3a3a3a" />
      {kind === "HQ" && (
        <g>
          <line x1={0} y1={-h - 110} x2={0} y2={-h - 420} stroke="#333" strokeWidth={40} />
          <path d={`M 0 ${-h - 420} L 330 ${-h - 330} L 0 ${-h - 240} Z`} fill={light} />
        </g>
      )}
      <g transform={`translate(${-w / 2 - 240},${-h * 0.55})`}>
        <polygon
          points="0,-200 173,-100 173,100 0,200 -173,100 -173,-100"
          fill="var(--color-badge)"
          stroke="#7a5b12"
          strokeWidth={30}
        />
        <text
          x={0}
          y={95}
          fontSize={300}
          fontWeight={800}
          textAnchor="middle"
          fill="#3a2c05"
          data-anim={levelFrom !== undefined ? "lvl" : undefined}
          data-from={levelFrom}
          data-to={levelFrom !== undefined ? level : undefined}
        >
          {levelFrom ?? level}
        </text>
      </g>
      <rect x={-w / 2} y={70} width={w} height={110} rx={40} fill="#2f2f2f" />
      <rect x={-w / 2 + 18} y={88} width={(w - 36) * hpFrac} height={74} rx={30} fill="var(--color-nhp)" />
    </g>
  );
}
