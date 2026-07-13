// 턴별 통계 — ANALYSIS 패널 차트 + 헤더 스탯의 공용 소스.

import type { TurnEvents } from "./events";
import type { GameState } from "./types";
import { hqOf } from "./state";
import { projectedWorkIncome } from "./turn";

export interface DayStats {
  warriors: [number, number];
  gold: [number, number];
  income: [number, number]; // 그 날의 노동 수입
  cumIncome: [number, number];
  cumSpent: [number, number];
  cumWarriors: [number, number]; // 누적 훈련(시작 3 포함)
  hqHp: [number, number];
  bases: [number, number]; // HQ 제외 기지 수
}

export function statsForState(st: GameState): Pick<DayStats, "warriors" | "gold" | "hqHp" | "bases"> {
  const warriors: [number, number] = [0, 0];
  for (const w of st.warriors.values()) if (w.hp > 0) warriors[w.side] += 1;
  const bases: [number, number] = [0, 0];
  for (const b of st.buildings.values()) if (b.kind === "BASE") bases[b.side] += 1;
  const hqL = hqOf(st, 0);
  const hqR = hqOf(st, 1);
  return {
    warriors,
    gold: [st.gold[0], st.gold[1]],
    hqHp: [hqL ? hqL.hp : 0, hqR ? hqR.hp : 0],
    bases,
  };
}

/** states[0..D], events[0..D-1] → stats[0..D] (stats[d] = d일차 종료 후) */
export function computeStats(states: GameState[], events: TurnEvents[]): DayStats[] {
  const out: DayStats[] = [];
  let cumIncome: [number, number] = [0, 0];
  let cumSpent: [number, number] = [0, 0];
  let cumWarriors: [number, number] = [3, 3];
  for (let d = 0; d < states.length; d++) {
    if (d > 0 && d - 1 < events.length) {
      const ev = events[d - 1];
      cumIncome = [cumIncome[0] + ev.incomeTotal[0], cumIncome[1] + ev.incomeTotal[1]];
      cumSpent = [cumSpent[0] + ev.spentTotal[0], cumSpent[1] + ev.spentTotal[1]];
      const t: [number, number] = [0, 0];
      for (const tr of ev.trained) t[tr.key < 0 ? 0 : 1] += 1;
      cumWarriors = [cumWarriors[0] + t[0], cumWarriors[1] + t[1]];
    }
    const base = statsForState(states[d]);
    out.push({
      ...base,
      // d>0: 그 날 실제 벌어들인 노동 수입. day 0(및 이벤트 없는 선두 상태): 초기
      // 위치가 벌어들일 수입을 투영해 표시(시작 시 본부 3전사 → +15).
      income:
        d > 0 && d - 1 < events.length
          ? events[d - 1].incomeTotal
          : projectedWorkIncome(states[d]),
      cumIncome: [...cumIncome],
      cumSpent: [...cumSpent],
      cumWarriors: [...cumWarriors],
    });
  }
  return out;
}
