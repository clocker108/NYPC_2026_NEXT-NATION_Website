// 엔진 유닛 테스트 — 픽스처가 못 덮는 미세 규칙들을 소형 맵으로 고정.

import { describe, expect, it } from "vitest";
import type { MapData } from "@/engine/map";
import type { GameState, Side } from "@/engine/types";
import { wkey } from "@/engine/types";
import { initState } from "@/engine/state";
import { applyTurn } from "@/engine/turn";
import { eventsToLogLines } from "@/engine/serialize";
import { generateMap } from "@/engine/mapgen";

// 직선 맵: 0-1-2-...-(n-1), 좌표 x=1000*i(중앙 0 대칭), 거점 = 중앙 하나
function lineMap(n: number): MapData {
  const mid = (n - 1) / 2;
  const x = Array.from({ length: n }, (_, i) => (i - mid) * 1000);
  const y = new Array(n).fill(0);
  const adj = Array.from({ length: n }, (_, i) => {
    const a: number[] = [];
    if (i > 0) a.push(i - 1);
    if (i < n - 1) a.push(i + 1);
    return a;
  });
  return { n, k: 1, x, y, strongholds: [mid], adj };
}

function addWarrior(st: GameState, side: Side, suffix: number, region: number, hp: number, target: number | null = null) {
  const k = wkey(side, suffix);
  st.warriors.set(k, { key: k, side, suffix, region, hp, movingTarget: target });
  if (suffix >= st.nextSuffix[side]) st.nextSuffix[side] = suffix + 1;
}

// 초기 전사들을 치우고 깨끗한 상태로
function bareState(m: MapData): GameState {
  const st = initState(m);
  st.warriors.clear();
  return st;
}

describe("전투", () => {
  it("기본 교전: 양측 cap만큼 틱, HP최저 우선 타격", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 2, 4); // A1 hp4
    addWarrior(st, 1, 1, 2, 4); // B1 hp4
    addWarrior(st, 1, 2, 2, 2); // B2 hp2 (최저 → 먼저 맞음)
    const { events } = applyTurn(m, st, [[], []]);
    const lines = eventsToLogLines(events);
    expect(lines).toContain("DAMAGE COMBAT A1 2"); // RIGHT cap 2
    expect(lines).toContain("DAMAGE COMBAT B2 1"); // LEFT cap 1 → HP최저 B2
  });

  it("cap 스냅샷: 먼저 죽은 전사도 자기 측 틱 수에 포함", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 2, 5); // A1 hp5
    addWarrior(st, 1, 1, 2, 1); // B1 hp1 — LEFT 틱에 즉사
    addWarrior(st, 1, 2, 2, 1); // B2 hp1
    const { events } = applyTurn(m, st, [[], []]);
    const lines = eventsToLogLines(events);
    // LEFT 1틱 → B1(동HP, 번호최저) 사망. RIGHT cap은 2(스냅샷) → A1이 2 맞음
    expect(lines).toContain("DAMAGE COMBAT A1 2");
    expect(lines).toContain("DAMAGE COMBAT B1 1");
    expect(events.deaths.map((d) => d.key)).toContain(wkey(1, 1));
  });

  it("포탑: 건물 주인의 첫 turret틱은 TURRET 표기", () => {
    const m = lineMap(5);
    const st = bareState(m);
    // RIGHT 기지 L1(hp6, 포탑1)이 중앙(2)에, LEFT 전사 2명 침공
    st.buildings.set(2, { region: 2, side: 1, kind: "BASE", level: 1, hp: 6 });
    addWarrior(st, 0, 1, 2, 1);
    addWarrior(st, 0, 2, 2, 3);
    const { events } = applyTurn(m, st, [[], []]);
    const lines = eventsToLogLines(events);
    expect(lines).toContain("DAMAGE TURRET A1 1"); // 포탑 1틱 = HP최저 A1
  });
});

describe("공성", () => {
  it("유휴틱 = 공성 피해, 로그엔 잔여HP로 클램프", () => {
    const m = lineMap(5);
    const st = bareState(m);
    st.buildings.set(2, { region: 2, side: 1, kind: "BASE", level: 1, hp: 2 }); // 남은 HP 2
    addWarrior(st, 0, 1, 2, 1);
    addWarrior(st, 0, 2, 2, 1);
    addWarrior(st, 0, 3, 2, 1);
    addWarrior(st, 0, 4, 2, 1); // LEFT 4명, 수비 전사 0 → 유휴 4
    const { events, state } = applyTurn(m, st, [[], []]);
    const lines = eventsToLogLines(events);
    expect(lines).toContain("SIEGE B 2 2"); // min(4, hp2) = 2
    expect(state.buildings.has(2)).toBe(false); // 파괴
    expect(events.sieges[0].destroyed).toBe(true);
  });

  it("양측 HQ 동시 파괴 = DRAW HQ_DESTROYED", () => {
    const m = lineMap(3); // 0=HQ_L, 2=HQ_R, 1=거점
    const st = bareState(m);
    st.buildings.get(0)!.hp = 1;
    st.buildings.get(2)!.hp = 1;
    // 서로의 HQ에 적 전사 1명씩 (수비 없음 → 유휴 1 → 공성 1 → 파괴)
    addWarrior(st, 1, 1, 0, 4);
    addWarrior(st, 0, 1, 2, 4);
    const { state } = applyTurn(m, st, [[], []]);
    expect(state.result).toEqual({ winner: "DRAW", reason: "HQ_DESTROYED" });
  });
});

describe("경제", () => {
  it("노동: work_cap 한도, 초과 인원 무시", () => {
    const m = lineMap(5);
    const st = bareState(m);
    // LEFT HQ L1 (workCap 1)에 전사 3명 → 수입 15
    addWarrior(st, 0, 1, 0, 4);
    addWarrior(st, 0, 2, 0, 4);
    addWarrior(st, 0, 3, 0, 4);
    st.gold[0] = 100;
    const { events } = applyTurn(m, st, [[], []]);
    // 수입 15, 유지비 3×2=6
    expect(events.incomeTotal[0]).toBe(15);
    expect(events.goldAfter[0]).toBe(100 + 15 - 6);
  });

  it("보급: 번호 오름차순, 골드 부족분만 HUNGER, 이후 일괄 제거", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 3, 2);
    addWarrior(st, 0, 2, 3, 1); // HUNGER 1 → hp0 → 제거
    addWarrior(st, 0, 3, 3, 2); // HUNGER 1 → hp1 생존
    st.gold[0] = 2; // A1만 지불 가능
    const { events, state } = applyTurn(m, st, [[], []]);
    const lines = eventsToLogLines(events);
    expect(lines).toContain("DAMAGE HUNGER A2 1");
    expect(lines).toContain("DAMAGE HUNGER A3 1");
    expect(lines).not.toContain("DAMAGE HUNGER A1 1");
    expect(state.warriors.has(wkey(0, 2))).toBe(false);
    expect(state.warriors.has(wkey(0, 3))).toBe(true);
  });
});

describe("이동", () => {
  it("핀: 같은 지역을 공유하면 양측 모두 핀(상호 핀)", () => {
    const m = lineMap(7);
    const st = bareState(m);
    addWarrior(st, 1, 1, 2, 4); // B1 — A1과 같은 지역
    addWarrior(st, 0, 1, 2, 4); // A1
    const { state, events } = applyTurn(m, st, [
      ["MOVE A1 5"],
      ["MOVE B1 6"],
    ]);
    expect(events.moves.length).toBe(0);
    expect(events.pinned).toContain(wkey(0, 1));
    expect(events.pinned).toContain(wkey(1, 1));
    expect(state.warriors.get(wkey(0, 1))!.movingTarget).toBe(5);
    expect(state.warriors.get(wkey(1, 1))!.movingTarget).toBe(6);
  });

  it("핀 스냅샷: 이번 턴 들어오는 적은 핀하지 않음(서로 스왑 통과 가능)", () => {
    const m = lineMap(7);
    const st = bareState(m);
    addWarrior(st, 0, 1, 2, 4); // A1: 2 → 5 (다음 홉 3)
    addWarrior(st, 1, 1, 3, 4); // B1: 3 → 1 (다음 홉 2)
    const { events } = applyTurn(m, st, [["MOVE A1 5"], ["MOVE B1 1"]]);
    // 스냅샷 기준 서로 다른 지역 → 둘 다 이동(스왑)
    expect(events.moves.some((mv) => mv.key === wkey(0, 1) && mv.to === 3)).toBe(true);
    expect(events.moves.some((mv) => mv.key === wkey(1, 1) && mv.to === 2)).toBe(true);
    expect(events.pinned.length).toBe(0);
  });

  it("자기 지역으로 MOVE: 요금 부과, 이동 이벤트 없음, 즉시 완료", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 3, 4);
    st.gold[0] = 50;
    const { state, events } = applyTurn(m, st, [["MOVE A1 3"], []]);
    expect(events.moves.length).toBe(0);
    expect(state.warriors.get(wkey(0, 1))!.movingTarget).toBe(null);
    // 이동비 10 + 유지비 2
    expect(state.gold[0]).toBe(50 - 10 - 2);
  });

  it("아군 건물 목적지는 이동 무료", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 2, 4);
    st.gold[0] = 50;
    const { state } = applyTurn(m, st, [["MOVE A1 0"], []]); // 0 = 아군 HQ
    // 이동비 0, 유지비 2
    expect(state.gold[0]).toBe(50 - 2);
  });
});

describe("WA 판정", () => {
  it("TRAIN 중복 = 해당 측 패배", () => {
    const m = lineMap(5);
    const st = initState(m);
    const { state } = applyTurn(m, st, [["TRAIN 1", "TRAIN 1"], []]);
    expect(state.result).toEqual({ winner: "RIGHT_WIN", reason: "WA" });
  });

  it("양측 동시 무효 = DRAW WA", () => {
    const m = lineMap(5);
    const st = initState(m);
    const { state } = applyTurn(m, st, [["FOO"], ["BAR 1"]]);
    expect(state.result).toEqual({ winner: "DRAW", reason: "WA" });
  });

  it("이동 중 전사 재명령 = WA", () => {
    const m = lineMap(7);
    const st = bareState(m);
    addWarrior(st, 0, 1, 0, 4, 6); // 이미 6으로 이동 중
    const { state } = applyTurn(m, st, [["MOVE A1 3"], []]);
    expect(state.result).toEqual({ winner: "RIGHT_WIN", reason: "WA" });
  });

  it("1페이즈 골드 순차 차감: UPGRADE가 MOVE보다 먼저 (제출 순서 무관)", () => {
    const m = lineMap(5);
    const st = bareState(m);
    addWarrior(st, 0, 1, 2, 4); // 중앙 거점 위
    addWarrior(st, 0, 2, 3, 4);
    st.gold[0] = 300; // 기지 건설(300) 후 이동(10) 불가
    // MOVE를 먼저 제출해도 엔진은 UPGRADE부터 적용해야 함
    const { state } = applyTurn(m, st, [["MOVE A2 4", "UPGRADE 2"], []]);
    expect(state.result).toEqual({ winner: "RIGHT_WIN", reason: "WA" });
  });

  it("HQ 파괴 지역엔 BUILD 불가", () => {
    const m = lineMap(5);
    const st = bareState(m);
    st.buildings.delete(0); // LEFT HQ 소멸 상태 가정
    addWarrior(st, 0, 1, 0, 4);
    const { state } = applyTurn(m, st, [["UPGRADE 0"], []]);
    expect(state.result).toEqual({ winner: "RIGHT_WIN", reason: "WA" });
  });
});

describe("맵 생성 불변식", () => {
  it("npRange: 구간 내 추첨 + 시드 재현성", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = generateMap({ seed, npRange: [35, 44] }); // "중간" 구간
      expect(m.n).toBeGreaterThanOrEqual(71);
      expect(m.n).toBeLessThanOrEqual(89);
      const m2 = generateMap({ seed, npRange: [35, 44] });
      expect(m2.n).toBe(m.n); // 같은 시드 = 같은 크기(같은 맵)
      expect(m2.x).toEqual(m.x);
    }
    expect(generateMap({ seed: 3, npRange: [25, 25] }).n).toBe(51); // 한 점 구간 = 고정
  });

  it("15개 시드: 대칭·홀수·거점 규칙·연결성", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const m = generateMap({ seed });
      const n = m.n;
      expect(n % 2).toBe(1);
      expect(n).toBeGreaterThanOrEqual(51);
      expect(n).toBeLessThanOrEqual(109);
      expect(m.k % 2).toBe(1);
      expect(m.k).toBeGreaterThanOrEqual(Math.ceil(0.15 * n) % 2 === 0 ? Math.ceil(0.15 * n) + 1 : Math.ceil(0.15 * n));
      expect(m.k).toBeLessThanOrEqual(Math.floor(0.2 * n));

      const mid = (n - 1) / 2;
      // 점대칭 (합=0 비교 — -0/+0 함정 회피)
      for (let i = 0; i < n; i++) {
        expect(m.x[i] + m.x[n - 1 - i]).toBe(0);
        expect(m.y[i] + m.y[n - 1 - i]).toBe(0);
      }
      expect(m.x[mid]).toBe(0);
      // (완화 후 x는 비단조일 수 있음 — 실제 공식 맵과 동일. HQ 극단성만 확인)
      expect(m.x[0]).toBeLessThan(0);
      expect(m.x[n - 1]).toBeGreaterThan(0);

      // 거점: 중앙 포함, HQ 제외, 대칭, 상호 비인접
      const sh = new Set(m.strongholds);
      expect(sh.has(mid)).toBe(true);
      expect(sh.has(0)).toBe(false);
      expect(sh.has(n - 1)).toBe(false);
      for (const s of sh) expect(sh.has(n - 1 - s)).toBe(true);
      for (const a of sh) {
        for (const b of sh) {
          if (a !== b) expect(m.adj[a].includes(b)).toBe(false);
        }
      }

      // 인접 대칭(무향) + 미러 대칭 + 연결성
      for (let u = 0; u < n; u++) {
        for (const v of m.adj[u]) {
          expect(m.adj[v].includes(u)).toBe(true);
          expect(m.adj[n - 1 - u].includes(n - 1 - v)).toBe(true);
        }
      }
      const seen = new Array(n).fill(false);
      const q = [0];
      seen[0] = true;
      for (let i = 0; i < q.length; i++) {
        for (const v of m.adj[q[i]]) if (!seen[v]) { seen[v] = true; q.push(v); }
      }
      expect(seen.every(Boolean)).toBe(true);
    }
  });
});
