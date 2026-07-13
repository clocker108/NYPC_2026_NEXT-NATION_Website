// AI 공용 헬퍼 — 상태 조회·안전 방어(checkPlan로 꼬리 자르기).

import type { MapData } from "@/engine/map";
import { dijkstraFrom, hqRegion } from "@/engine/map";
import type { Command, GameState, Side, Warrior } from "@/engine/types";
import { bWorkCap, hqOf } from "@/engine/state";
import { checkPlan } from "@/engine/plan";

export interface SideView {
  myHq: number;
  oppHq: number;
  hqLevel: number;
  gold: number;
  mine: Warrior[];
  idle: Warrior[]; // 살아있고 이동 중 아님
  enemies: Warrior[];
  enemyRegions: Set<number>;
  myBuildings: number[];
  workSlots: Map<number, number>; // region → 남은 노동 슬롯(주둔 반영)
  unclaimedStrongholds: number[];
}

export function makeView(st: GameState, m: MapData, side: Side): SideView {
  const myHq = hqRegion(m, side);
  const oppHq = hqRegion(m, (1 - side) as Side);
  const mine: Warrior[] = [];
  const idle: Warrior[] = [];
  const enemies: Warrior[] = [];
  const enemyRegions = new Set<number>();
  for (const w of st.warriors.values()) {
    if (w.hp <= 0) continue;
    if (w.side === side) {
      mine.push(w);
      if (w.movingTarget === null) idle.push(w);
    } else {
      enemies.push(w);
      enemyRegions.add(w.region);
    }
  }
  const myBuildings: number[] = [];
  const workSlots = new Map<number, number>();
  const stationed = new Map<number, number>();
  for (const w of mine) {
    stationed.set(w.region, (stationed.get(w.region) ?? 0) + 1);
    // 이동 중이면 목적지 슬롯을 선점한 것으로 간주
    if (w.movingTarget !== null) stationed.set(w.movingTarget, (stationed.get(w.movingTarget) ?? 0) + 1);
  }
  for (const b of st.buildings.values()) {
    if (b.side !== side) continue;
    myBuildings.push(b.region);
    const cap = bWorkCap(b);
    workSlots.set(b.region, Math.max(0, cap - (stationed.get(b.region) ?? 0)));
  }
  const claimed = new Set(st.buildings.keys());
  const unclaimedStrongholds = m.strongholds.filter((r) => !claimed.has(r));
  const hq = hqOf(st, side);
  return {
    myHq,
    oppHq,
    hqLevel: hq?.level ?? 0,
    gold: st.gold[side],
    mine,
    idle,
    enemies,
    enemyRegions,
    myBuildings,
    workSlots,
    unclaimedStrongholds,
  };
}

/** 목적지까지 거리 (edge_weight 다익스트라) */
export function distTo(m: MapData, target: number, from: number): number {
  const d = dijkstraFrom(m, target)[from];
  return d < 0 ? Number.MAX_SAFE_INTEGER : d;
}

/** 후보 명령을 엔진 검증으로 방어 — 무효면 뒤에서부터 잘라 항상 유효한 계획만 반환 */
export function sanitize(m: MapData, st: GameState, side: Side, cmds: Command[]): Command[] {
  let cur = [...cmds];
  while (cur.length > 0) {
    if (checkPlan(m, st, side, cur).ok) return cur;
    cur = cur.slice(0, -1);
  }
  return [];
}
