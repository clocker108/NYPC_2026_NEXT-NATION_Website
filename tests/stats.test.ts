// 통계 파생 검증 — 리플레이 상태와 일관적인지.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLog } from "@/engine/logParser";
import { replayLog } from "@/engine/replay";
import { computeStats } from "@/engine/stats";

describe("computeStats", () => {
  it("2200.txt: 길이·골드 일치·누적 단조증가", () => {
    const text = readFileSync(join(__dirname, "fixtures", "2200.txt"), "utf-8");
    const replay = replayLog(parseLog(text));
    const stats = computeStats(replay.states, replay.events);

    expect(stats.length).toBe(replay.states.length);
    for (let d = 0; d < stats.length; d++) {
      expect(stats[d].gold[0]).toBe(replay.states[d].gold[0]);
      expect(stats[d].gold[1]).toBe(replay.states[d].gold[1]);
      if (d > 0) {
        expect(stats[d].cumIncome[0]).toBeGreaterThanOrEqual(stats[d - 1].cumIncome[0]);
        expect(stats[d].cumSpent[1]).toBeGreaterThanOrEqual(stats[d - 1].cumSpent[1]);
        expect(stats[d].cumWarriors[0]).toBeGreaterThanOrEqual(stats[d - 1].cumWarriors[0]);
      }
    }
    // 초기값
    expect(stats[0].warriors).toEqual([3, 3]);
    expect(stats[0].gold).toEqual([500, 500]);
    expect(stats[0].hqHp).toEqual([10, 10]);
    // day 0 수입은 초기 위치의 노동 투영값: 본부(workCap 1) × 3전사 → +15씩.
    expect(stats[0].income).toEqual([15, 15]);
    // day 0 누적 수입은 아직 0 (투영은 표시용, 실현 누적엔 미포함).
    expect(stats[0].cumIncome).toEqual([0, 0]);
  });
});
