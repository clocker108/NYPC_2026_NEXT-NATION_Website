// 파싱된 로그를 JS 엔진으로 재생 — 리플레이 뷰어와 픽스처 테스트 공용.

import type { ParsedLog } from "./logParser";
import type { GameState } from "./types";
import type { TurnEvents } from "./events";
import { initState } from "./state";
import { applyTurn } from "./turn";
import { eventsToLogLines } from "./serialize";

export interface ReplayMismatch {
  day: number;
  expected: string[];
  got: string[];
}

export interface ReplayResult {
  states: GameState[]; // states[0] = 초기, states[d] = d일차 종료 후
  events: TurnEvents[]; // events[d-1] = d일차 이벤트
  mismatches: ReplayMismatch[];
  finalResult: string | null; // 엔진이 계산한 최종 결과 ("RESULT ..." 형식)
}

export function replayLog(parsed: ParsedLog): ReplayResult {
  const states: GameState[] = [initState(parsed.map)];
  const events: TurnEvents[] = [];
  const mismatches: ReplayMismatch[] = [];

  let cur = states[0];
  for (const turn of parsed.turns) {
    const { state, events: ev } = applyTurn(parsed.map, cur, turn.cmds);
    states.push(state);
    events.push(ev);
    cur = state;

    if (turn.hasResult) {
      const got = eventsToLogLines(ev);
      const expected = turn.resultLines;
      if (got.length !== expected.length || got.some((g, idx) => g !== expected[idx])) {
        mismatches.push({ day: turn.day, expected, got });
      }
    }
    if (state.result) break;
  }

  const finalResult = cur.result ? `RESULT ${cur.result.winner} ${cur.result.reason}` : null;
  return { states, events, mismatches, finalResult };
}
