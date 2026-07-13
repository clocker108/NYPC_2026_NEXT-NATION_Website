// 엔진 충실도의 핵심 검증: 실전 로그 9개를 JS 엔진으로 재생해
// 매 턴 결과 라인(TIME 제외)과 최종 RESULT가 정확히 일치하는지 확인.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseLog } from "@/engine/logParser";
import { replayLog } from "@/engine/replay";

const FIXTURE_DIR = join(__dirname, "fixtures");
const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".txt"));

describe("실전 로그 리플레이 충실도", () => {
  it("픽스처가 존재한다", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of fixtures) {
    it(`${file}: 전 턴 결과 라인 + 최종 RESULT 일치`, () => {
      const text = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      const parsed = parseLog(text);
      const replay = replayLog(parsed);

      if (replay.mismatches.length > 0) {
        const m = replay.mismatches[0];
        const diff = [
          `첫 불일치: day ${m.day}`,
          `--- expected (${m.expected.length}줄)`,
          ...m.expected,
          `--- got (${m.got.length}줄)`,
          ...m.got,
        ].join("\n");
        expect.fail(`${file}: ${replay.mismatches.length}개 턴 불일치\n${diff}`);
      }

      expect(replay.finalResult).toBe(parsed.finalResult);
    });
  }
});
