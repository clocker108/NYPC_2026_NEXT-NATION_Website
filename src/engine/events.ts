// 턴 이벤트 — 애니메이션·Turn Details·차트·로그 직렬화가 전부 이걸로부터 파생된다.

import type { Side, WKey } from "./types";

export type DamageCause = "TURRET" | "COMBAT" | "HUNGER";

export interface CommandCost {
  side: Side;
  line: string; // 제출된 원시 라인 (예: "MOVE A16 0")
  cost: number; // 실제 차감 골드 (0 = FREE)
}

export interface TurnEvents {
  day: number;
  // WA로 즉시 종료된 턴이면 세팅 (이후 해소 이벤트는 비어있음)
  wa: { loser: Side | "BOTH"; messages: Partial<Record<Side, string>> } | null;

  commandCosts: CommandCost[];

  upgrades: { region: number; side: Side; kind: "BUILD" | "UPGRADE" | "HEAL"; newLevel: number }[];
  trained: { key: WKey; region: number; hp: number }[];
  moves: { key: WKey; from: number; to: number; arrived: boolean }[];
  pinned: WKey[];
  // (cause,key)별 병합 누적 — region은 애니메이션용(전사는 턴 내 한 지역)
  damages: { cause: DamageCause; key: WKey; amount: number; region: number }[];
  sieges: { side: Side; region: number; dealt: number; destroyed: boolean }[];
  incomes: { side: Side; region: number; workers: WKey[] }[];
  deaths: { key: WKey; region: number }[];

  goldAfter: [number, number];
  incomeTotal: [number, number]; // 이번 턴 노동 수입 합계
  spentTotal: [number, number];  // 이번 턴 명령으로 지출한 골드 합계
}

export function emptyEvents(day: number): TurnEvents {
  return {
    day,
    wa: null,
    commandCosts: [],
    upgrades: [],
    trained: [],
    moves: [],
    pinned: [],
    damages: [],
    sieges: [],
    incomes: [],
    deaths: [],
    goldAfter: [0, 0],
    incomeTotal: [0, 0],
    spentTotal: [0, 0],
  };
}

// 타임라인 빨간 틱 조건: 전투/공성 발생 턴
export function isCombatTurn(ev: TurnEvents): boolean {
  return ev.damages.some((d) => d.cause !== "HUNGER") || ev.sieges.length > 0;
}
