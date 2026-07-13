// 핫시트 플레이 루프 E2E (스토어 레벨, DOM 없음):
// 시작 → A 계획/제출 → 교대 → B 계획/제출 → 해소 → 다음 날.

import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "@/store/gameStore";

describe("핫시트 플레이 루프", () => {
  beforeEach(() => {
    useGameStore.getState().backToMenu();
  });

  it("한 턴 왕복: 훈련 명령이 해소되어 전사 수가 는다", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42 });

    expect(s().screen).toBe("game");
    expect(s().mode).toBe("hotseat");
    expect(s().states.length).toBe(1);
    expect(s().live?.phase).toBe("planA");

    // A: 본부 훈련 1
    s().queueTrain(1);
    expect(s().live?.queued).toEqual([{ type: "TRAIN", n: 1 }]);
    expect(s().live?.planError).toBe(null);
    s().submitPlan();
    expect(s().live?.phase).toBe("handover");

    s().confirmHandover();
    expect(s().live?.phase).toBe("planB");

    // B: 빈 턴 제출 → 해소는 즉시 계산되지만 연출은 reveal 확인 후
    s().submitPlan();
    expect(s().states.length).toBe(2);
    expect(s().live?.phase).toBe("reveal");
    expect(s().anim).toBe(null); // "모두 보세요" 확인 전엔 연출 시작 안 함
    expect(s().viewDay).toBe(1);

    s().confirmReveal();
    expect(s().anim).toEqual({ day: 1 }); // 이제 모두 앞에서 해소 연출
    expect(s().live?.phase).toBe("review"); // 연출 후엔 자유 관전
    s().animDone();
    expect(s().anim).toBe(null);

    // 관전 중엔 커튼 없음 — 맵 아무 셀이나 클릭하면 다음(A에게 커튼)으로
    s().clickCell(3);
    expect(s().live?.phase).toBe("handoverBack");
    expect(s().selectedCell).toBe(null); // 셀 선택으로 처리되지 않음
    s().confirmHandover();
    expect(s().live?.phase).toBe("planA"); // 다음 날 A 차례

    const st1 = s().states[1];
    // A 전사 4명(3+훈련1), B 3명
    let a = 0, b = 0;
    for (const w of st1.warriors.values()) (w.side === 0 ? a++ : b++);
    expect(a).toBe(4);
    expect(b).toBe(3);
    // A 골드: 500 - 120(훈련) + 15(HQ노동) - 8(유지 4명) = 387
    expect(st1.gold[0]).toBe(387);
  });

  it("턴 제한: 계획 페이즈마다 무장, 커튼/해소에서 해제", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42, turnLimit: 30 });

    // A 계획 시작 — 타이머 무장 (~30초 뒤 마감)
    const d0 = s().turnDeadline;
    expect(d0).not.toBe(null);
    expect(d0! - Date.now()).toBeGreaterThan(25_000);
    expect(d0! - Date.now()).toBeLessThanOrEqual(30_000);

    // A 제출 → 커튼 동안은 해제
    s().submitPlan();
    expect(s().live?.phase).toBe("handover");
    expect(s().turnDeadline).toBe(null);

    // B 계획 진입 → 재무장
    s().confirmHandover();
    expect(s().live?.phase).toBe("planB");
    expect(s().turnDeadline).not.toBe(null);

    // B 제출(해소) → reveal 이후로는 해제
    s().submitPlan();
    expect(s().live?.phase).toBe("reveal");
    expect(s().turnDeadline).toBe(null);

    // 다음 날 A 계획 진입 → 재무장
    s().confirmReveal();
    s().animDone();
    s().confirmReview();
    s().confirmHandover();
    expect(s().live?.phase).toBe("planA");
    expect(s().turnDeadline).not.toBe(null);
  });

  it("턴 제한 없음(기본): 타이머가 무장되지 않는다", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42 });
    expect(s().turnDeadline).toBe(null);
    s().submitPlan();
    s().confirmHandover();
    expect(s().turnDeadline).toBe(null);
  });

  it("닉네임: 입력하면 names에 반영, 비우면 기본값", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42, nameA: " 철수 ", nameB: "영희" });
    expect(s().names).toEqual(["철수", "영희"]); // 공백 트림
    s().backToMenu();
    s().startHotseat({ np: 25, seed: 42, nameA: "", nameB: "  " });
    expect(s().names).toEqual(["플레이어 A", "플레이어 B"]);
  });

  it("이동 큐잉: 셀 클릭 → 목적지 클릭 → MOVE 큐", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42 });
    const map = s().map!;

    // A 본부(0) 클릭 → 출발지 선택 (보낼 수는 기본 1명)
    s().clickCell(0);
    expect(s().live?.selCell).toBe(0);
    expect(s().live?.selCount).toBe(1);

    // 2명만 보내기
    s().setSelCount(2);
    s().beginDestMode();
    expect(s().live?.destMode).toBe(true);

    // 인접 셀로
    const dest = map.adj[0][0];
    s().clickCell(dest);
    const moves = s().live!.queued.filter((c) => c.type === "MOVE");
    expect(moves.length).toBe(2);
    expect(moves.every((c) => c.type === "MOVE" && c.region === dest)).toBe(true);
    expect(s().live?.destMode).toBe(false);
  });

  it("검증: 골드 초과 명령은 큐에 안 들어감", () => {
    const s = () => useGameStore.getState();
    s().startHotseat({ np: 25, seed: 42 });
    // 훈련 최대 1(HQ L1) — 초과 시도는 스텝퍼가 막지만, 큐 검증도 이중 안전망
    s().queueTrain(1);
    // 남은 380으로 기지 건설(300)은 가능하나 본부 위 전사가 있는 거점이 없어 UPGRADE는 무효
    const shd = s().map!.strongholds[0];
    s().queueUpgrade(shd);
    expect(s().live?.planError).not.toBe(null); // 전사 없는 거점 → 엔진 검증 실패
    expect(s().live?.queued.filter((c) => c.type === "UPGRADE").length).toBe(0);
  });
});
