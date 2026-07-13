// 맵 표시 공용 헬퍼 — MapView(베이스 렌더)와 TurnAnimationLayer(연출)가
// 동일한 칩 위치/카운트 계산을 공유해 연출과 실제 렌더가 픽셀 단위로 이어진다.

import type { MapData } from "@/engine/map";
import type { GameState, Side } from "@/engine/types";
import type { TurnEvents } from "@/engine/events";
import { sideFromKey } from "@/engine/types";

export interface CellInfo {
  warriors: [number, number];
}

export function collectCells(st: GameState): Map<number, CellInfo> {
  const map = new Map<number, CellInfo>();
  for (const w of st.warriors.values()) {
    if (w.hp <= 0) continue;
    let c = map.get(w.region);
    if (!c) {
      c = { warriors: [0, 0] };
      map.set(w.region, c);
    }
    c.warriors[w.side] += 1;
  }
  return map;
}

/** 이번 턴 전사 수가 변하는 지역(도착·훈련·사망) — 연출 중 이 지역의 칩 표시는
 *  TurnAnimationLayer가 소유하고, MapView는 베이스 칩을 그리지 않는다(겹침 방지). */
export function touchedRegions(events: TurnEvents): Set<number> {
  const s = new Set<number>();
  for (const mv of events.moves) s.add(mv.to);
  for (const t of events.trained) s.add(t.region);
  for (const d of events.deaths) s.add(d.region);
  return s;
}

/** 연출용 베이스: 이번 턴 이동하는 전사를 출발 셀에서 미리 뺀다(이동 클론이 그들을 대신함) */
export function adjustCellsForAnim(cells: Map<number, CellInfo>, events: TurnEvents): Map<number, CellInfo> {
  const out = new Map<number, CellInfo>();
  for (const [r, c] of cells) out.set(r, { warriors: [c.warriors[0], c.warriors[1]] });
  for (const mv of events.moves) {
    const side = sideFromKey(mv.key);
    const c = out.get(mv.from);
    if (c && c.warriors[side] > 0) c.warriors[side] -= 1;
  }
  return out;
}

/** 전사 칩 그룹의 translate 좌표 (MapView 렌더와 동일 수식) */
export function chipGroupPos(
  map: MapData,
  st: GameState,
  cells: Map<number, CellInfo>,
  region: number,
  side: Side,
): { x: number; y: number } {
  const hasB = st.buildings.has(region);
  const info = cells.get(region);
  const both = !!info && info.warriors[0] > 0 && info.warriors[1] > 0;
  return {
    x: map.x[region] + (both ? (side === 0 ? -420 : 420) : 0),
    y: map.y[region] + (hasB ? 620 : 150),
  };
}
