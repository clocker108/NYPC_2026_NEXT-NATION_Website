// 상태 생성/복제/조회 헬퍼 — testing-tool.py init_state 등 포팅.

import {
  BASE_LEVELS,
  BASE_MAX_LEVEL,
  BASE_HEAL_COST,
  HQ_HEAL_COST,
  HQ_LEVELS,
  HQ_MAX_LEVEL,
  START_GOLD,
  START_WARRIORS,
  hqWarriorHp,
} from "./constants";
import type { MapData } from "./map";
import type { Building, GameState, Side, Warrior, WKey } from "./types";
import { wkey } from "./types";

export function initState(m: MapData): GameState {
  const st: GameState = {
    day: 0,
    gold: [START_GOLD, START_GOLD],
    warriors: new Map(),
    buildings: new Map(),
    nextSuffix: [START_WARRIORS + 1, START_WARRIORS + 1],
    result: null,
  };
  const hqL = 0;
  const hqR = m.n - 1;
  st.buildings.set(hqL, { region: hqL, side: 0, kind: "HQ", level: 1, hp: HQ_LEVELS[1].hp });
  st.buildings.set(hqR, { region: hqR, side: 1, kind: "HQ", level: 1, hp: HQ_LEVELS[1].hp });
  for (let sfx = 1; sfx <= START_WARRIORS; sfx++) {
    const kl = wkey(0, sfx);
    const kr = wkey(1, sfx);
    st.warriors.set(kl, { key: kl, side: 0, suffix: sfx, region: hqL, hp: hqWarriorHp(1), movingTarget: null });
    st.warriors.set(kr, { key: kr, side: 1, suffix: sfx, region: hqR, hp: hqWarriorHp(1), movingTarget: null });
  }
  return st;
}

export function cloneState(st: GameState): GameState {
  const warriors = new Map<WKey, Warrior>();
  for (const [k, w] of st.warriors) warriors.set(k, { ...w });
  const buildings = new Map<number, Building>();
  for (const [r, b] of st.buildings) buildings.set(r, { ...b });
  return {
    day: st.day,
    gold: [st.gold[0], st.gold[1]],
    warriors,
    buildings,
    nextSuffix: [st.nextSuffix[0], st.nextSuffix[1]],
    result: st.result ? { ...st.result } : null,
  };
}

// 건물 파생 속성 (Building 메서드 대응)
export function bMaxLevel(b: Building): number {
  return b.kind === "HQ" ? HQ_MAX_LEVEL : BASE_MAX_LEVEL;
}
export function bMaxHpNow(b: Building): number {
  return b.kind === "HQ" ? HQ_LEVELS[b.level].hp : BASE_LEVELS[b.level].hp;
}
export function bTurret(b: Building): number {
  return b.kind === "HQ" ? HQ_LEVELS[b.level].turret : BASE_LEVELS[b.level].turret;
}
export function bWorkCap(b: Building): number {
  return b.kind === "HQ" ? HQ_LEVELS[b.level].workCap : BASE_LEVELS[b.level].workCap;
}
export function bTrainCap(b: Building): number {
  return HQ_LEVELS[b.level].trainCap;
}
export function bHealCost(b: Building): number {
  return b.kind === "HQ" ? HQ_HEAL_COST : BASE_HEAL_COST;
}
export function bNextLevelCost(b: Building): number {
  if (b.level >= bMaxLevel(b)) return -1;
  return b.kind === "HQ" ? HQ_LEVELS[b.level + 1].upgradeCost : BASE_LEVELS[b.level + 1].cost;
}

export function hqOf(st: GameState, side: Side): Building | null {
  for (const b of st.buildings.values()) {
    if (b.kind === "HQ" && b.side === side) return b;
  }
  return null;
}

export function anyWarriorAt(st: GameState, region: number, side: Side, friendly: boolean): boolean {
  for (const w of st.warriors.values()) {
    if (w.region === region && w.hp > 0 && (w.side === side) === friendly) return true;
  }
  return false;
}
