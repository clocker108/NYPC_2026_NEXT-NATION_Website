// 계획(큐) 검증 — UI에서 WA를 원천 봉쇄하기 위해 엔진 그 자체로 검증한다.
// 검증 = 해당 측 명령만 넣은 가상 턴을 돌려 WA 여부·비용을 회수 (엔진과 100% 일치 보장).

import type { MapData } from "./map";
import type { Command, GameState, Side } from "./types";
import { commandsToLines } from "./types";
import { applyTurn } from "./turn";
import type { CommandCost } from "./events";

export interface PlanCheck {
  ok: boolean;
  error: string | null;
  goldLeft: number; // 1페이즈 지출 후 남는 골드 (수입/유지비 반영 전)
  costs: CommandCost[]; // 명령별 실제 비용
}

export function checkPlan(m: MapData, st: GameState, side: Side, cmds: Command[]): PlanCheck {
  const lines = commandsToLines(side, cmds);
  const blocks: [string[], string[]] = side === 0 ? [lines, []] : [[], lines];
  const { state, events } = applyTurn(m, st, blocks);

  if (state.result?.reason === "WA" && events.wa) {
    const msg = events.wa.messages[side] ?? "규칙 위반";
    return { ok: false, error: msg, goldLeft: st.gold[side], costs: [] };
  }
  return {
    ok: true,
    error: null,
    goldLeft: st.gold[side] - events.spentTotal[side],
    costs: events.commandCosts.filter((c) => c.side === side),
  };
}
