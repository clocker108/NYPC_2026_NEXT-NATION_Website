// 인터넷 대전 방 상태기계 유닛테스트 — DO 런타임 없이 순수 함수로 검증.

import { describe, expect, it } from "vitest";
import {
  initialRoom,
  step,
  type Effect,
  type RoomState,
} from "../worker/src/roomLogic";
import { GRACE_MS, LOBBY_TTL_MS, type MapJson, type ServerMsg } from "@/online/protocol";
import { generateMap } from "@/engine/mapgen";

const MAP: MapJson = generateMap({ seed: 3, np: 25 });

function sent(effects: Effect[], seat: 0 | 1): ServerMsg[] {
  return effects.filter((e): e is Extract<Effect, { fx: "send" }> => e.fx === "send" && e.seat === seat).map((e) => e.msg);
}

function makePlaying(turnLimit: 0 | 30 = 0): RoomState {
  let s = initialRoom();
  ({ state: s } = step(s, { e: "create", now: 1000, code: "123456", nick: "호스트", map: MAP, turnLimit, token: "tokA" }));
  const r = step(s, { e: "join", now: 2000, nick: "게스트", token: "tokB" });
  return r.state;
}

describe("roomLogic", () => {
  it("create → created(코드·토큰·seat 0)", () => {
    const r = step(initialRoom(), {
      e: "create", now: 1000, code: "123456", nick: "호스트", map: MAP, turnLimit: 0, token: "tokA",
    });
    const msgs = sent(r.effects, 0);
    expect(msgs[0]).toMatchObject({ t: "created", code: "123456", token: "tokA", seat: 0 });
    expect(r.state.phase).toBe("lobby");
  });

  it("join → 양측 start (호스트 A석, 입장자 B석 + 토큰)", () => {
    const s = makePlaying();
    expect(s.phase).toBe("playing");
    expect(s.nicks).toEqual(["호스트", "게스트"]);
    // start 검증은 effects에서
    let s0 = initialRoom();
    ({ state: s0 } = step(s0, { e: "create", now: 1, code: "111111", nick: "A", map: MAP, turnLimit: 60, token: "tA" }));
    const r = step(s0, { e: "join", now: 2, nick: "B", token: "tB" });
    const toHost = sent(r.effects, 0).find((m) => m.t === "start");
    const toJoin = sent(r.effects, 1).find((m) => m.t === "start");
    expect(toHost).toMatchObject({ t: "start", seat: 0, turnLimit: 60 });
    expect(toJoin).toMatchObject({ t: "start", seat: 1, token: "tB" });
    expect((toHost as { deadlineAt?: number }).deadlineAt).toBe(2 + 60_000);
  });

  it("양측 제출 페어링 → turn 브로드캐스트 + lastDay 증가", () => {
    let s = makePlaying();
    let r = step(s, { e: "cmds", now: 3000, seat: 0, day: 1, lines: ["TRAIN 1"] });
    s = r.state;
    expect(sent(r.effects, 1).some((m) => m.t === "peer_submitted")).toBe(true);
    r = step(s, { e: "cmds", now: 4000, seat: 1, day: 1, lines: [] });
    s = r.state;
    expect(s.lastDay).toBe(1);
    const turn0 = sent(r.effects, 0).find((m) => m.t === "turn");
    const turn1 = sent(r.effects, 1).find((m) => m.t === "turn");
    expect(turn0).toMatchObject({ t: "turn", day: 1, a: ["TRAIN 1"], b: [] });
    expect(turn1).toMatchObject({ t: "turn", day: 1 });
    expect(s.hist).toHaveLength(1);
  });

  it("day 가드: 과거 day는 멱등 무시, 미래 day는 BAD_DAY", () => {
    let s = makePlaying();
    s = step(s, { e: "cmds", now: 3000, seat: 0, day: 1, lines: [] }).state;
    s = step(s, { e: "cmds", now: 3100, seat: 1, day: 1, lines: [] }).state;
    const past = step(s, { e: "cmds", now: 3200, seat: 0, day: 1, lines: ["MOVE A1 3"] });
    expect(past.state.subs.a).toBeNull(); // 무시됨
    expect(sent(past.effects, 0).some((m) => m.t === "err")).toBe(false);
    const future = step(s, { e: "cmds", now: 3300, seat: 0, day: 5, lines: [] });
    expect(sent(future.effects, 0).some((m) => m.t === "err" && m.code === "BAD_DAY")).toBe(true);
  });

  it("턴 타이머 만료 → 미제출측 빈 턴으로 자동 해소", () => {
    let s = makePlaying(30);
    s = step(s, { e: "cmds", now: 5000, seat: 0, day: 1, lines: ["TRAIN 1"] }).state;
    const dl = s.deadlineAt!;
    const r = step(s, { e: "alarm", now: dl });
    expect(r.state.lastDay).toBe(1);
    const turn = sent(r.effects, 0).find((m) => m.t === "turn");
    expect(turn).toMatchObject({ day: 1, a: ["TRAIN 1"], b: [] });
    // 다음 턴 마감도 재장전
    expect(r.state.deadlineAt).toBe(dl + 30_000);
  });

  it("끊김 → peer_down, grace 만료 → 남은 쪽 몰수승", () => {
    let s = makePlaying();
    let r = step(s, { e: "close", now: 10_000, seat: 1 });
    s = r.state;
    expect(sent(r.effects, 0).find((m) => m.t === "peer_down")).toMatchObject({ graceUntil: 10_000 + GRACE_MS });
    r = step(s, { e: "alarm", now: 10_000 + GRACE_MS });
    expect(r.state.phase).toBe("finished");
    expect(r.state.result).toBe("RESULT LEFT_WIN FORFEIT");
    expect(sent(r.effects, 0).find((m) => m.t === "finish")).toMatchObject({ result: "RESULT LEFT_WIN FORFEIT" });
  });

  it("rejoin → peer_up + 놓친 턴 재생(resume.missed)", () => {
    let s = makePlaying();
    s = step(s, { e: "cmds", now: 1, seat: 0, day: 1, lines: ["TRAIN 1"] }).state;
    s = step(s, { e: "cmds", now: 2, seat: 1, day: 1, lines: [] }).state;
    s = step(s, { e: "close", now: 3, seat: 1 }).state;
    // 끊긴 동안 한 턴 더 (타이머 없으니 상대 제출 후 대기 상태로 남음 — 여기선 2턴째 해소까지 확인 위해 재현)
    s = step(s, { e: "cmds", now: 4, seat: 0, day: 2, lines: [] }).state;
    const r = step(s, { e: "rejoin", now: 5, seat: 1, lastDay: 0 });
    const resume = sent(r.effects, 1).find((m) => m.t === "resume");
    expect(resume).toMatchObject({
      t: "resume",
      seat: 1,
      youSubmitted: false,
      peerSubmitted: true, // seat0의 day2 제출이 대기 중
    });
    expect((resume as { missed: unknown[] }).missed).toHaveLength(1); // day 1 재생
    expect(sent(r.effects, 0).some((m) => m.t === "peer_up")).toBe(true);
  });

  it("finish 대조: 양 좌석이 같은 결과로 finish해야 종료·중계", () => {
    let s = makePlaying();
    s = step(s, { e: "cmds", now: 1, seat: 0, day: 1, lines: [] }).state;
    s = step(s, { e: "cmds", now: 2, seat: 1, day: 1, lines: [] }).state;
    // 한 좌석만 finish → 아직 종료 안 됨(그리핑 방지), 상대에게 중계도 안 함
    const r1 = step(s, { e: "finish", now: 3, seat: 0, day: 1, result: "RESULT LEFT_WIN HQ_DESTROYED" });
    expect(r1.state.phase).toBe("playing");
    expect(sent(r1.effects, 1).some((m) => m.t === "finish")).toBe(false);
    // 상대 좌석이 같은 결과로 finish → 종료 + 양쪽 통보
    const r2 = step(r1.state, { e: "finish", now: 4, seat: 1, day: 1, result: "RESULT LEFT_WIN HQ_DESTROYED" });
    expect(r2.state.phase).toBe("finished");
    expect(r2.state.result).toBe("RESULT LEFT_WIN HQ_DESTROYED");
    expect(sent(r2.effects, 0).find((m) => m.t === "finish")).toMatchObject({ result: "RESULT LEFT_WIN HQ_DESTROYED" });
    expect(sent(r2.effects, 1).find((m) => m.t === "finish")).toMatchObject({ result: "RESULT LEFT_WIN HQ_DESTROYED" });
  });

  it("finish 위조 방지: 상대가 다른 결과를 우겨도 종료되지 않음", () => {
    let s = makePlaying();
    s = step(s, { e: "cmds", now: 1, seat: 0, day: 1, lines: [] }).state;
    s = step(s, { e: "cmds", now: 2, seat: 1, day: 1, lines: [] }).state;
    // seat0이 위조 결과를 반복 전송해도 종료·중계 없음
    let r = step(s, { e: "finish", now: 3, seat: 0, day: 1, result: "RESULT LEFT_WIN HQ_DESTROYED" });
    r = step(r.state, { e: "finish", now: 4, seat: 0, day: 1, result: "RESULT LEFT_WIN HQ_DESTROYED" });
    expect(r.state.phase).toBe("playing");
    // 상대가 '다른' 결과로 finish → 불일치라 여전히 미종료
    r = step(r.state, { e: "finish", now: 5, seat: 1, day: 1, result: "RESULT RIGHT_WIN HQ_DESTROYED" });
    expect(r.state.phase).toBe("playing");
    expect(sent(r.effects, 0).some((m) => m.t === "finish")).toBe(false);
  });

  it("로비 leave → 방 폐기 / 로비 TTL 만료 → 폐기", () => {
    let s = initialRoom();
    ({ state: s } = step(s, { e: "create", now: 1000, code: "222222", nick: "A", map: MAP, turnLimit: 0, token: "t" }));
    const r = step(s, { e: "leave", now: 2000, seat: 0 });
    expect(r.effects.some((e) => e.fx === "delete")).toBe(true);

    const ttl = step(s, { e: "alarm", now: 1000 + LOBBY_TTL_MS });
    expect(ttl.effects.some((e) => e.fx === "delete")).toBe(true);
  });

  it("게임 중 leave → 몰수패", () => {
    const s = makePlaying();
    const r = step(s, { e: "leave", now: 9000, seat: 0 });
    expect(r.state.result).toBe("RESULT RIGHT_WIN FORFEIT");
  });
});
