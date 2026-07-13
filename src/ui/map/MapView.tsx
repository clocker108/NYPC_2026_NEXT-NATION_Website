"use client";

// SVG 맵 — Voronoi 셀 + 건물/전사 글리프 + 선택/호버 + 줌/팬.
// 플레이 모드에서는 셀 클릭이 store.clickCell로 위임돼 출발지/목적지 선택을 처리한다.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { soundManager } from "@/audio/soundManager";
import { useGameStore } from "@/store/gameStore";
import { CLIP_RADIUS } from "@/engine/voronoi";
import { pathPreview, type MapData } from "@/engine/map";
import { bMaxHpNow } from "@/engine/state";
import type { GameState, Side } from "@/engine/types";
import TurnAnimationLayer from "./TurnAnimationLayer";
import { adjustCellsForAnim, chipGroupPos, collectCells, touchedRegions, type CellInfo } from "./mapDisplay";
import { BuildingGlyph, WarriorChip } from "./Glyphs";

const VIEW = CLIP_RADIUS * 1.06;

/* ── 메모 레이어들 — 팬/줌/큐잉/호버 재렌더에서 무거운 DOM 재계산을 차단.
   props(맵·해당 날짜 상태·콜백)가 같으면 통째로 스킵된다. ── */

const CellsLayer = memo(function CellsLayer({
  map,
  ptsStrs,
  st,
  onCellClick,
  onHover,
}: {
  map: MapData;
  ptsStrs: string[];
  st: GameState;
  onCellClick: (i: number) => void;
  onHover: (i: number | null) => void;
}) {
  const strongholdSet = useMemo(() => new Set(map.strongholds), [map]);
  const hqCells = useMemo(() => new Set([0, map.n - 1]), [map]);
  const cellFill = (i: number): string => {
    const b = st.buildings.get(i);
    if (b) return b.side === 0 ? "var(--color-nredtint)" : "var(--color-nbluetint)";
    if (strongholdSet.has(i)) return "#f2dfa0";
    return "var(--color-cellneutral)";
  };
  return (
    <g>
      {ptsStrs.map((pts, i) =>
        pts ? (
          <polygon
            key={i}
            points={pts}
            fill={cellFill(i)}
            stroke={hqCells.has(i) ? "#222" : "var(--color-cellstroke)"}
            strokeWidth={hqCells.has(i) ? 70 : 25}
            strokeDasharray={hqCells.has(i) ? "260 140" : undefined}
            onClick={() => onCellClick(i)}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className="cursor-pointer"
          />
        ) : null,
      )}
    </g>
  );
});

const EdgesLayer = memo(function EdgesLayer({ map }: { map: MapData }) {
  return (
    <g pointerEvents="none">
      {map.adj.map((row, u) =>
        row
          .filter((v) => v > u)
          .map((v) => (
            <line key={`${u}-${v}`} x1={map.x[u]} y1={map.y[u]} x2={map.x[v]} y2={map.y[v]} stroke="#b5aa90" strokeWidth={22} />
          )),
      )}
    </g>
  );
});

const NumbersLayer = memo(function NumbersLayer({ map, ptsStrs }: { map: MapData; ptsStrs: string[] }) {
  return (
    <g pointerEvents="none">
      {ptsStrs.map((pts, i) =>
        pts ? (
          <text key={`n${i}`} x={map.x[i]} y={map.y[i] - 320} fontSize={300} textAnchor="middle" fill="#6b6455">
            #{i}
          </text>
        ) : null,
      )}
    </g>
  );
});

const UnitsLayer = memo(function UnitsLayer({
  map,
  st,
  cells,
  animOwned,
}: {
  map: MapData;
  st: GameState;
  cells: Map<number, CellInfo>;
  animOwned: Set<number> | null;
}) {
  return (
    <g pointerEvents="none">
      {[...st.buildings.values()].map((b) => (
        <BuildingGlyph
          key={`b${b.region}`}
          x={map.x[b.region]}
          y={map.y[b.region] - 120}
          side={b.side}
          kind={b.kind}
          level={b.level}
          hp={b.hp}
          maxHp={bMaxHpNow(b)}
        />
      ))}
      {[...cells.entries()].map(([region, info]) => (
        <g key={`w${region}`}>
          {([0, 1] as Side[]).map((side) => {
            if (info.warriors[side] <= 0) return null;
            if (animOwned?.has(region)) return null; // 연출 레이어의 궤적 칩이 대신 표시
            const pos = chipGroupPos(map, st, cells, region, side);
            return <WarriorChip key={side} x={pos.x} y={pos.y} side={side} count={info.warriors[side]} />;
          })}
        </g>
      ))}
    </g>
  );
});

export default function MapView() {
  const map = useGameStore((s) => s.map);
  const polygons = useGameStore((s) => s.polygons);
  const states = useGameStore((s) => s.states);
  const events = useGameStore((s) => s.events);
  const viewDay = useGameStore((s) => s.viewDay);
  const anim = useGameStore((s) => s.anim);
  const animDone = useGameStore((s) => s.animDone);
  const playing = useGameStore((s) => s.playing);
  const speed = useGameStore((s) => s.speed);
  const selectedCell = useGameStore((s) => s.selectedCell);
  const clickCell = useGameStore((s) => s.clickCell);
  const setHoverCell = useGameStore((s) => s.setHoverCell);
  const options = useGameStore((s) => s.options);
  // live 객체 전체가 아니라 destMode만 구독 — 계획 중 매 큐 편집마다 무거운 맵이 리렌더되지 않게
  const destMode = useGameStore((s) => s.live?.destMode ?? false);

  const [zoom, setZoom] = useState(0.75);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 연출 중엔 직전 상태를 베이스로 그리고, 위에 이벤트 연출을 얹는다
  const animEvents = anim ? events[anim.day - 1] : null;
  const baseDay = anim && animEvents ? anim.day - 1 : viewDay;
  const st = states[baseDay];
  const postState = anim && animEvents ? states[anim.day] : null;

  // 연출 중엔 이동하는 전사를 출발 셀에서 미리 뺀다 (이동 클론이 그들을 대신)
  const cells = useMemo(() => {
    if (!st) return new Map<number, CellInfo>();
    const base = collectCells(st);
    return animEvents ? adjustCellsForAnim(base, animEvents) : base;
  }, [st, animEvents]);

  // 수가 변하는 지역의 칩은 연출 레이어(궤적 칩)가 소유 — 베이스 칩은 숨겨 겹침 방지
  const animOwned = useMemo(() => (animEvents ? touchedRegions(animEvents) : null), [animEvents]);

  const movingPaths = useMemo(() => {
    if (!st || !map || !options.showPaths) return [];
    const paths: { side: Side; pts: [number, number][] }[] = [];
    for (const w of st.warriors.values()) {
      if (w.hp <= 0 || w.movingTarget === null || w.movingTarget === w.region) continue;
      const nodes = pathPreview(map, w.region, w.movingTarget);
      paths.push({ side: w.side, pts: nodes.map((n) => [map.x[n], map.y[n]]) });
    }
    return paths;
  }, [st, map, options.showPaths]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    setZoom((z) => Math.max(0.4, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
    },
    [pan],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (e.buttons === 0) {
      // SVG 밖에서 버튼을 뗀 채 재진입 — 유령 드래그 방지
      dragRef.current = null;
      return;
    }
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    if (!d.moved) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = rect ? (2 * VIEW) / Math.min(rect.width, rect.height) : 1;
    setPan({ x: d.panX + (e.clientX - d.startX) * scale, y: d.panY + (e.clientY - d.startY) * scale });
  }, []);
  const onPointerUp = useCallback(() => {
    // click은 polygon onClick이 처리; 드래그였으면 클릭 무시를 위해 flag 유지 후 해제
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }, []);

  const cellClick = useCallback(
    (i: number) => {
      if (dragRef.current?.moved) return;
      // 평소 맵 클릭은 타격음, 이동 목적지 선택 중엔 시작 화면 클릭음(확정감) — 위임 리스너는 button만
      soundManager.play(useGameStore.getState().live?.destMode ? "menu-click" : "map-click");
      clickCell(i);
    },
    [clickCell],
  );

  const toggleFullscreen = useCallback(() => {
    // 맵만 전체화면하면 오버레이·명령독이 top layer 밖으로 사라진다 — 게임 화면 전체를 대상
    const el = wrapRef.current?.closest<HTMLElement>("[data-game-root]") ?? wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  }, []);

  // 폴리곤 points 문자열은 맵이 바뀔 때 한 번만 계산 (팬/줌마다 재계산 금지)
  const ptsStrs = useMemo(() => polygons.map((poly) => poly.map((p) => p.join(",")).join(" ")), [polygons]);

  if (!map || !st) return null;


  return (
    <div className="relative min-h-0 min-w-0 flex-1" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`block h-full w-full touch-none ${destMode ? "cursor-crosshair" : ""}`}
        viewBox={`${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`} style={{ willChange: "transform" }}>
          <CellsLayer map={map} ptsStrs={ptsStrs} st={st} onCellClick={cellClick} onHover={setHoverCell} />

          {selectedCell !== null && ptsStrs[selectedCell] && (
            <polygon points={ptsStrs[selectedCell]} fill="none" stroke="#8e44ad" strokeWidth={110} pointerEvents="none" />
          )}

          {options.showEdges && <EdgesLayer map={map} />}

          {movingPaths.map((p, idx) => (
            <g key={idx} pointerEvents="none" opacity={0.55}>
              <polyline
                points={p.pts.map((pt) => pt.join(",")).join(" ")}
                fill="none"
                stroke={p.side === 0 ? "var(--color-nred)" : "var(--color-nblue)"}
                strokeWidth={55}
                strokeDasharray="180 120"
              />
              <circle
                cx={p.pts[p.pts.length - 1][0]}
                cy={p.pts[p.pts.length - 1][1]}
                r={110}
                fill={p.side === 0 ? "var(--color-nred)" : "var(--color-nblue)"}
              />
            </g>
          ))}

          <UnitsLayer map={map} st={st} cells={cells} animOwned={animOwned} />

          {options.showCellNumbers && <NumbersLayer map={map} ptsStrs={ptsStrs} />}

          {/* 턴 해소 연출 (animejs) */}
          {anim && animEvents && postState && (
            <TurnAnimationLayer
              key={`anim-${anim.day}`}
              map={map}
              events={animEvents}
              baseState={st}
              baseCells={cells}
              postState={postState}
              durScale={playing ? Math.min(2, Math.max(0.5, speed)) : 1}
              onDone={animDone}
            />
          )}
        </g>
      </svg>

      {anim && animEvents && (
        <button
          className="absolute right-4 top-4 rounded-lg border border-chromeline bg-chrome2/90 px-3 py-1.5 text-sm text-white hover:border-zinc-500"
          onClick={animDone}
        >
          ⏭ 연출 건너뛰기 (Esc)
        </button>
      )}

      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-xl border border-chromeline bg-chrome2 px-3 py-2">
        <button className="cursor-pointer px-1.5 text-lg" onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}>
          −
        </button>
        <input
          type="range"
          className="w-28"
          min={0.4}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <button className="cursor-pointer px-1.5 text-lg" onClick={() => setZoom((z) => Math.min(4, z * 1.2))}>
          +
        </button>
        <span className="min-w-12 text-center text-[13px]">×{zoom.toFixed(2)}</span>
        <button className="cursor-pointer px-1.5 text-lg" onClick={toggleFullscreen} title="전체화면">
          ⛶
        </button>
      </div>

      {destMode && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-sm">
          목적지 셀을 클릭하세요 (같은 셀 클릭 = 취소)
        </div>
      )}
    </div>
  );
}
