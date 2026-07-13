// AI 스모크 — JS AI끼리 완주(WA 0건, 정상 종료)하는지.

import { describe, expect, it } from "vitest";
import { generateMap } from "@/engine/mapgen";
import { initState } from "@/engine/state";
import { applyTurn } from "@/engine/turn";
import { commandsToLines } from "@/engine/types";
import { mulberry32 } from "@/engine/mapgen";
import easyGrower from "@/ai/easyGrower";
import normalAttacker from "@/ai/normalAttacker";

describe("JS AI 스모크", () => {
  for (const seed of [1, 7, 13]) {
    it(`seed ${seed}: 보통(공격형) vs 쉬움(성장형) — WA 없이 완주`, () => {
      const map = generateMap({ seed, np: 27 });
      let st = initState(map);
      const rngA = mulberry32(seed * 3 + 1);
      const rngB = mulberry32(seed * 5 + 2);

      let turns = 0;
      while (!st.result && turns < 200) {
        const cmdsA = normalAttacker.getCommands(st, map, 0, rngA);
        const cmdsB = easyGrower.getCommands(st, map, 1, rngB);
        const { state } = applyTurn(map, st, [commandsToLines(0, cmdsA), commandsToLines(1, cmdsB)]);
        st = state;
        turns++;
      }

      expect(st.result).not.toBe(null);
      expect(st.result!.reason).not.toBe("WA"); // AI는 절대 WA 금지
    });
  }

  it("공격형이 성장형을 이긴다 (샘플 3판 다수결)", () => {
    let wins = 0;
    for (const seed of [21, 22, 23]) {
      const map = generateMap({ seed, np: 27 });
      let st = initState(map);
      const rngA = mulberry32(seed);
      const rngB = mulberry32(seed + 100);
      let turns = 0;
      while (!st.result && turns < 200) {
        const cmdsA = normalAttacker.getCommands(st, map, 0, rngA);
        const cmdsB = easyGrower.getCommands(st, map, 1, rngB);
        const { state } = applyTurn(map, st, [commandsToLines(0, cmdsA), commandsToLines(1, cmdsB)]);
        st = state;
        turns++;
      }
      if (st.result?.winner === "LEFT_WIN") wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });
});
