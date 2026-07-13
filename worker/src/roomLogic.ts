// 방 상태기계 — 순수 함수 (state, event) → { state', effects }.
// Durable Object 런타임 없이 유닛테스트 가능하도록 IO(소켓·알람·스토리지)는
// 전부 effect 목록으로 반환하고, room.ts(DO 셸)가 해석·실행한다.

import {
  GRACE_MS,
  LOBBY_TTL_MS,
  PLAYING_TTL_MS,
  FINISHED_TTL_MS,
  MAX_DAY,
  type MapJson,
  type Seat,
  type ServerMsg,
  type TurnLimit,
} from "../../src/online/protocol";

export type Phase = "lobby" | "playing" | "finished";

export interface RoomState {
  code: string;
  createdAt: number;
  phase: Phase;
  turnLimit: TurnLimit;
  map: MapJson | null;
  nicks: [string, string];
  tokens: [string, string]; // [host, joiner] — joiner 자리는 입장 시 발급
  joined: boolean; // 입장자가 한 번이라도 들어왔는가
  connected: [boolean, boolean];
  disc: [number | null, number | null]; // 끊긴 시각 (grace 계산)
  lastDay: number; // 해소 완료된 마지막 day
  subs: { a: string[] | null; b: string[] | null }; // day = lastDay+1 대기 제출
  hist: { day: number; a: string[]; b: string[] }[]; // resume 재생용 전체 히스토리
  deadlineAt: number | null; // 현재 턴 마감 (턴 제한 있을 때)
  result: string | null;
  // 한 좌석이 보낸 종료 단언(대조 대기). 서버엔 엔진이 없어 결과를 검증 못 하므로,
  // 양 좌석이 같은 day·result로 finish를 보내야만 실제 종료 처리한다(락스텝상 정상 종료 시 양측 동일).
  pendingFinish: { seat: Seat; result: string } | null;
}

export type RoomEvent =
  | { e: "create"; now: number; code: string; nick: string; map: MapJson; turnLimit: TurnLimit; token: string }
  | { e: "join"; now: number; nick: string; token: string }
  | { e: "rejoin"; now: number; seat: Seat; lastDay: number }
  | { e: "cmds"; now: number; seat: Seat; day: number; lines: string[] }
  | { e: "finish"; now: number; seat: Seat; day: number; result: string }
  | { e: "leave"; now: number; seat: Seat }
  | { e: "close"; now: number; seat: Seat } // 소켓 끊김
  | { e: "alarm"; now: number };

export type Effect =
  | { fx: "send"; seat: Seat; msg: ServerMsg }
  | { fx: "close"; seat: Seat; code?: number } // 해당 좌석 소켓 닫기
  | { fx: "setAlarm"; at: number | null } // null = 알람 해제
  | { fx: "delete" }; // 방 폐기 (storage.deleteAll)

export interface StepResult {
  state: RoomState;
  effects: Effect[];
}

export function initialRoom(): RoomState {
  return {
    code: "",
    createdAt: 0,
    phase: "lobby",
    turnLimit: 0,
    map: null,
    nicks: ["", ""],
    tokens: ["", ""],
    joined: false,
    connected: [false, false],
    disc: [null, null],
    lastDay: 0,
    subs: { a: null, b: null },
    hist: [],
    deadlineAt: null,
    result: null,
    pendingFinish: null,
  };
}

/** 다음에 울려야 할 알람 시각 계산 (턴 마감 / grace 만료 / 방 TTL 중 최솟값) */
export function nextAlarmAt(s: RoomState): number | null {
  const cands: number[] = [];
  if (s.phase === "playing" && s.deadlineAt !== null) cands.push(s.deadlineAt);
  for (const d of s.disc) if (d !== null) cands.push(d + GRACE_MS);
  const ttl =
    s.phase === "finished" ? FINISHED_TTL_MS : s.phase === "playing" ? PLAYING_TTL_MS : LOBBY_TTL_MS;
  if (s.createdAt > 0) cands.push(s.createdAt + ttl);
  return cands.length ? Math.min(...cands) : null;
}

function withAlarm(state: RoomState, effects: Effect[]): StepResult {
  effects.push({ fx: "setAlarm", at: nextAlarmAt(state) });
  return { state, effects };
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** 양측 제출이 모이면 턴 해소 → hist 기록 + 브로드캐스트 */
function resolveTurn(s: RoomState, now: number, effects: Effect[]): void {
  // day 상한 초과(악용/비정상) — 더 해소하지 않고 마감 알람만 끊어 hist 증가를 멈춘다 (TTL이 정리)
  if (s.lastDay + 1 > MAX_DAY) {
    s.deadlineAt = null;
    return;
  }
  const a = s.subs.a ?? [];
  const b = s.subs.b ?? [];
  const day = s.lastDay + 1;
  s.hist.push({ day, a, b });
  s.lastDay = day;
  s.subs = { a: null, b: null };
  s.pendingFinish = null; // 새 턴이 해소되면 이전 종료 단언은 무효
  s.deadlineAt = s.turnLimit > 0 ? now + s.turnLimit * 1000 : null;
  const msg: ServerMsg = {
    t: "turn",
    day,
    a,
    b,
    deadlineAt: s.deadlineAt ?? undefined,
    now,
  };
  if (s.connected[0]) effects.push({ fx: "send", seat: 0, msg });
  if (s.connected[1]) effects.push({ fx: "send", seat: 1, msg });
}

function startPlaying(s: RoomState, now: number, effects: Effect[]): void {
  s.phase = "playing";
  s.deadlineAt = s.turnLimit > 0 ? now + s.turnLimit * 1000 : null;
  for (const seat of [0, 1] as Seat[]) {
    effects.push({
      fx: "send",
      seat,
      msg: {
        t: "start",
        map: s.map!,
        nicks: s.nicks,
        seat,
        turnLimit: s.turnLimit,
        token: seat === 1 ? s.tokens[1] : undefined,
        deadlineAt: s.deadlineAt ?? undefined,
        now,
      },
    });
  }
}

function forfeit(s: RoomState, winnerSeat: Seat, effects: Effect[]): void {
  s.phase = "finished";
  s.result = `RESULT ${winnerSeat === 0 ? "LEFT_WIN" : "RIGHT_WIN"} FORFEIT`;
  s.deadlineAt = null;
  const w = winnerSeat;
  if (s.connected[w]) effects.push({ fx: "send", seat: w, msg: { t: "finish", result: s.result } });
  const l = other(w);
  if (s.connected[l]) effects.push({ fx: "send", seat: l, msg: { t: "finish", result: s.result } });
}

export function step(state: RoomState, ev: RoomEvent): StepResult {
  // 상태는 복제해 순수성 유지 (hist는 append-only라 얕은 복제 + 배열 복제)
  const s: RoomState = {
    ...state,
    nicks: [...state.nicks],
    tokens: [...state.tokens],
    connected: [...state.connected],
    disc: [...state.disc],
    subs: { ...state.subs },
    hist: [...state.hist],
  };
  const effects: Effect[] = [];

  switch (ev.e) {
    case "create": {
      s.code = ev.code;
      s.createdAt = ev.now;
      s.turnLimit = ev.turnLimit;
      s.map = ev.map;
      s.nicks[0] = ev.nick;
      s.tokens[0] = ev.token;
      s.connected[0] = true;
      s.disc[0] = null;
      effects.push({ fx: "send", seat: 0, msg: { t: "created", code: s.code, token: s.tokens[0], seat: 0 } });
      return withAlarm(s, effects);
    }

    case "join": {
      // 재입장(joined=true) 상황은 rejoin으로만 — join은 최초 1회
      s.nicks[1] = ev.nick;
      s.tokens[1] = ev.token;
      s.joined = true;
      s.connected[1] = true;
      s.disc[1] = null;
      if (s.connected[0]) {
        startPlaying(s, ev.now, effects);
      }
      // 호스트가 순간 끊겨 있으면: 재접속(rejoin) 시 lobby resume → 그때 start
      return withAlarm(s, effects);
    }

    case "rejoin": {
      s.connected[ev.seat] = true;
      s.disc[ev.seat] = null;
      const peer = other(ev.seat);
      if (s.connected[peer]) effects.push({ fx: "send", seat: peer, msg: { t: "peer_up" } });

      if (s.phase === "lobby" && s.joined && s.connected[0] && s.connected[1]) {
        // 로비에서 양측이 모두 살아나면 시작
        startPlaying(s, ev.now, effects);
        return withAlarm(s, effects);
      }

      const missed = s.hist.filter((h) => h.day > ev.lastDay);
      effects.push({
        fx: "send",
        seat: ev.seat,
        msg: {
          t: "resume",
          phase: s.phase === "finished" ? "playing" : s.phase, // finished면 아래 finish도 즉시 전송
          code: s.code,
          seat: ev.seat,
          map: s.map!,
          nicks: s.nicks,
          turnLimit: s.turnLimit,
          missed,
          youSubmitted: (ev.seat === 0 ? s.subs.a : s.subs.b) !== null,
          peerSubmitted: (ev.seat === 0 ? s.subs.b : s.subs.a) !== null,
          peerConnected: s.connected[peer],
          deadlineAt: s.deadlineAt ?? undefined,
          now: ev.now,
        },
      });
      if (s.phase === "finished" && s.result) {
        effects.push({ fx: "send", seat: ev.seat, msg: { t: "finish", result: s.result } });
      }
      return withAlarm(s, effects);
    }

    case "cmds": {
      if (s.phase !== "playing") {
        effects.push({ fx: "send", seat: ev.seat, msg: { t: "err", code: "BAD_DAY", msg: "게임 중이 아님" } });
        return withAlarm(s, effects);
      }
      const expect = s.lastDay + 1;
      if (ev.day !== expect) {
        // 지연 재전송 등으로 이미 해소된 day면 조용히 무시, 미래 day는 오류
        if (ev.day <= s.lastDay) return withAlarm(s, effects);
        effects.push({ fx: "send", seat: ev.seat, msg: { t: "err", code: "BAD_DAY", msg: `expected ${expect}` } });
        return withAlarm(s, effects);
      }
      // 하드 day 상한 — 엔진은 200일에 종료되므로 그 이상은 악용(hist 무한 증가). 거부.
      if (expect > MAX_DAY) {
        effects.push({ fx: "send", seat: ev.seat, msg: { t: "err", code: "BAD_DAY", msg: "day limit" } });
        return withAlarm(s, effects);
      }
      const mineKey = ev.seat === 0 ? "a" : "b";
      if (s.subs[mineKey] !== null) return withAlarm(s, effects); // 중복 제출 무시(멱등)
      s.subs[mineKey] = ev.lines;
      const peer = other(ev.seat);
      const peerKey = ev.seat === 0 ? "b" : "a";
      if (s.subs[peerKey] !== null) {
        resolveTurn(s, ev.now, effects);
      } else if (s.connected[peer]) {
        effects.push({ fx: "send", seat: peer, msg: { t: "peer_submitted", day: ev.day } });
      }
      return withAlarm(s, effects);
    }

    case "finish": {
      // 서버엔 엔진이 없어 결과를 검증 못 한다 → 양 좌석이 같은 day·result로 finish를 보낼 때만 종료.
      // 락스텝상 정상 종료 시 두 클라의 결정론 엔진이 동일 결과를 내므로 둘 다 같은 finish를 보낸다.
      // 혼자만 보낸 finish로는 상대 게임을 임의 결과로 끝낼 수 없다(그리핑 방지). 몰수(forfeit)는
      // 서버가 직접 생성하는 별도 경로라 이 대조와 무관하게 신뢰된다.
      if (s.phase === "playing" && ev.day === s.lastDay) {
        const pf = s.pendingFinish;
        if (pf && pf.seat === other(ev.seat) && pf.result === ev.result) {
          s.phase = "finished";
          s.result = ev.result;
          s.pendingFinish = null;
          s.deadlineAt = null;
          // 확정된(양측 합의) 결과를 양 좌석에 통보
          if (s.connected[0]) effects.push({ fx: "send", seat: 0, msg: { t: "finish", result: ev.result } });
          if (s.connected[1]) effects.push({ fx: "send", seat: 1, msg: { t: "finish", result: ev.result } });
        } else {
          // 첫 finish(또는 같은 좌석 재전송·결과 불일치) → 상대 확인을 기다림. 브로드캐스트 안 함.
          s.pendingFinish = { seat: ev.seat, result: ev.result };
        }
      }
      return withAlarm(s, effects);
    }

    case "leave": {
      if (s.phase === "lobby") {
        // 호스트가 대기 중 취소 → 방 폐기
        effects.push({ fx: "delete" });
        return { state: s, effects };
      }
      if (s.phase === "playing") {
        forfeit(s, other(ev.seat), effects);
      }
      return withAlarm(s, effects);
    }

    case "close": {
      s.connected[ev.seat] = false;
      s.disc[ev.seat] = ev.now;
      const peer = other(ev.seat);
      if (s.phase === "playing" && s.connected[peer]) {
        effects.push({
          fx: "send",
          seat: peer,
          msg: { t: "peer_down", graceUntil: ev.now + GRACE_MS, now: ev.now },
        });
      }
      return withAlarm(s, effects);
    }

    case "alarm": {
      // ① 턴 마감: 미제출측 [] 자동 제출로 해소
      if (s.phase === "playing" && s.deadlineAt !== null && ev.now >= s.deadlineAt) {
        resolveTurn(s, ev.now, effects);
      }
      // ② grace 만료: 게임 중이면 남은 쪽 몰수승, 로비/양측이면 폐기
      for (const seat of [0, 1] as Seat[]) {
        const d = s.disc[seat];
        if (d !== null && ev.now >= d + GRACE_MS) {
          s.disc[seat] = null;
          const peer = other(seat);
          if (s.phase === "playing") {
            if (s.connected[peer] || s.disc[peer] !== null) {
              forfeit(s, peer, effects);
            } else {
              // 양쪽 다 grace 만료 → 조용히 폐기
              effects.push({ fx: "delete" });
              return { state: s, effects };
            }
          }
        }
      }
      // ③ 방 TTL
      const ttl =
        s.phase === "finished" ? FINISHED_TTL_MS : s.phase === "playing" ? PLAYING_TTL_MS : LOBBY_TTL_MS;
      if (s.createdAt > 0 && ev.now >= s.createdAt + ttl) {
        effects.push({ fx: "close", seat: 0 });
        effects.push({ fx: "close", seat: 1 });
        effects.push({ fx: "delete" });
        return { state: s, effects };
      }
      return withAlarm(s, effects);
    }
  }
}
