// 인터넷 대전 WS E2E — wrangler dev(:8787)가 떠 있을 때만 실행 (bridgeE2e 패턴).
// Node 22 네이티브 WebSocket 클라이언트 2개 + 실제 TS 엔진으로 락스텝을 검증한다.
// 타이머(30초 대기) 테스트는 느려서 WS_TIMER_TEST=1 일 때만 돈다.

import { describe, expect, it } from "vitest";
import { generateMap } from "@/engine/mapgen";
import { initState } from "@/engine/state";
import { applyTurn } from "@/engine/turn";
import type { GameState } from "@/engine/types";
import { PROTOCOL_V, type ServerMsg } from "@/online/protocol";

const WS_BASE = "ws://localhost:8787";

// skipIf는 수집 시점에 평가되므로 프로브도 모듈 최상위에서 (bridgeE2e와 동일 패턴)
let up = false;
try {
  const res = await fetch("http://localhost:8787/", { signal: AbortSignal.timeout(1500) });
  up = res.ok;
} catch {
  up = false;
}

/** 수신 메시지 큐 + 타입 대기 헬퍼 */
class WsClient {
  ws: WebSocket;
  private queue: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  closed = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
    this.ws.addEventListener("close", () => (this.closed = true));
  }

  opened(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", () => res(), { once: true });
      this.ws.addEventListener("error", () => rej(new Error("ws open 실패")), { once: true });
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  waitFor<T extends ServerMsg["t"]>(t: T, timeoutMs = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const pred = (m: ServerMsg) => m.t === t;
    const buffered = this.queue.findIndex(pred);
    if (buffered >= 0) return Promise.resolve(this.queue.splice(buffered, 1)[0] as Extract<ServerMsg, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${t} 대기 시간 초과`)), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

/** 락스텝 비교용 상태 지문 */
function fingerprint(st: GameState): string {
  const warriors = [...st.warriors.values()]
    .map((w) => `${w.key}:${w.region}:${w.hp}:${w.movingTarget ?? "-"}`)
    .sort()
    .join("|");
  const buildings = [...st.buildings.values()]
    .map((b) => `${b.region}:${b.side}:${b.kind}:${b.level}:${b.hp}`)
    .sort()
    .join("|");
  return `${st.day};${st.gold[0]},${st.gold[1]};${warriors};${buildings};${st.result?.winner ?? ""}`;
}

describe.skipIf(!up)("인터넷 대전 WS E2E", () => {
  it("방 생성→입장→3턴 락스텝 (양측 상태 지문 일치)", { timeout: 30_000 }, async () => {
    const map = generateMap({ seed: 11, np: 25 });

    const host = new WsClient(`${WS_BASE}/ws?role=host`);
    await host.opened();
    host.send({ t: "create", v: PROTOCOL_V, nick: "호스트", map, turnLimit: 0 });
    const created = await host.waitFor("created");
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.seat).toBe(0);

    const guest = new WsClient(`${WS_BASE}/ws?role=join&code=${created.code}`);
    await guest.opened();
    guest.send({ t: "join", v: PROTOCOL_V, nick: "게스트" });
    const [startH, startG] = await Promise.all([host.waitFor("start"), guest.waitFor("start")]);
    expect(startH.seat).toBe(0);
    expect(startG.seat).toBe(1);
    expect(startG.token).toBeTruthy();
    expect(startH.nicks).toEqual(["호스트", "게스트"]);
    expect(startG.map.n).toBe(map.n);

    // 양측 각자 엔진으로 락스텝 시뮬레이션
    let stH = initState(map);
    let stG = initState(map);
    const plans: [string[], string[]][] = [
      [["TRAIN 1"], []],
      [[], ["TRAIN 1"]],
      [["TRAIN 1"], ["TRAIN 1"]],
    ];
    for (let day = 1; day <= 3; day++) {
      const [aLines, bLines] = plans[day - 1];
      host.send({ t: "cmds", day, lines: aLines });
      // 상대 제출 표시가 게스트에게 도착
      const ps = await guest.waitFor("peer_submitted");
      expect(ps.day).toBe(day);
      guest.send({ t: "cmds", day, lines: bLines });
      const [turnH, turnG] = await Promise.all([host.waitFor("turn"), guest.waitFor("turn")]);
      expect(turnH.day).toBe(day);
      expect(turnG).toEqual(turnH);
      stH = applyTurn(map, stH, [turnH.a, turnH.b]).state;
      stG = applyTurn(map, stG, [turnG.a, turnG.b]).state;
      expect(fingerprint(stG)).toBe(fingerprint(stH));
    }

    host.close();
    guest.close();
  });

  it("끊김→peer_down→rejoin resume→다음 턴 정상", { timeout: 30_000 }, async () => {
    const map = generateMap({ seed: 12, np: 25 });

    const host = new WsClient(`${WS_BASE}/ws?role=host`);
    await host.opened();
    host.send({ t: "create", v: PROTOCOL_V, nick: "A", map, turnLimit: 0 });
    const created = await host.waitFor("created");

    let guest = new WsClient(`${WS_BASE}/ws?role=join&code=${created.code}`);
    await guest.opened();
    guest.send({ t: "join", v: PROTOCOL_V, nick: "B" });
    const startG = await guest.waitFor("start");
    await host.waitFor("start");
    const guestToken = startG.token!;

    // 1턴 해소
    host.send({ t: "cmds", day: 1, lines: [] });
    guest.send({ t: "cmds", day: 1, lines: [] });
    await Promise.all([host.waitFor("turn"), guest.waitFor("turn")]);

    // 게스트 끊김 → 호스트에 peer_down, 그 사이 호스트는 2일차 제출
    guest.close();
    const down = await host.waitFor("peer_down");
    expect(down.graceUntil).toBeGreaterThan(Date.now());
    host.send({ t: "cmds", day: 2, lines: ["TRAIN 1"] });

    // 게스트 재접속 (lastDay=1 — 1일차까지 알고 있음)
    guest = new WsClient(`${WS_BASE}/ws?role=rejoin&code=${created.code}`);
    await guest.opened();
    guest.send({ t: "rejoin", v: PROTOCOL_V, token: guestToken, lastDay: 1 });
    const [resume, peerUp] = await Promise.all([guest.waitFor("resume"), host.waitFor("peer_up")]);
    expect(peerUp.t).toBe("peer_up");
    expect(resume.seat).toBe(1);
    expect(resume.missed).toHaveLength(0); // 1일차까지 이미 알고 있음
    expect(resume.youSubmitted).toBe(false);
    expect(resume.peerSubmitted).toBe(true); // 호스트의 2일차 제출이 대기 중

    // 재접속 후 정상 진행
    guest.send({ t: "cmds", day: 2, lines: [] });
    const [t2h, t2g] = await Promise.all([host.waitFor("turn"), guest.waitFor("turn")]);
    expect(t2h.day).toBe(2);
    expect(t2g).toEqual(t2h);

    // 잘못된 토큰은 거부
    const bad = new WsClient(`${WS_BASE}/ws?role=rejoin&code=${created.code}`);
    await bad.opened();
    bad.send({ t: "rejoin", v: PROTOCOL_V, token: "wrong", lastDay: 0 });
    const err = await bad.waitFor("err");
    expect(err.code).toBe("BAD_TOKEN");

    host.close();
    guest.close();
  });

  it("없는 방 입장 → NO_ROOM", { timeout: 15_000 }, async () => {
    const c = new WsClient(`${WS_BASE}/ws?role=join&code=000001`);
    await c.opened();
    c.send({ t: "join", v: PROTOCOL_V, nick: "X" });
    const err = await c.waitFor("err");
    expect(err.code).toBe("NO_ROOM");
  });

  it.skipIf(!process.env.WS_TIMER_TEST)(
    "턴 타이머(30초) 만료 → 미제출측 빈 턴 자동 해소",
    { timeout: 60_000 },
    async () => {
      const map = generateMap({ seed: 13, np: 25 });
      const host = new WsClient(`${WS_BASE}/ws?role=host`);
      await host.opened();
      host.send({ t: "create", v: PROTOCOL_V, nick: "A", map, turnLimit: 30 });
      const created = await host.waitFor("created");
      const guest = new WsClient(`${WS_BASE}/ws?role=join&code=${created.code}`);
      await guest.opened();
      guest.send({ t: "join", v: PROTOCOL_V, nick: "B" });
      const start = await guest.waitFor("start");
      expect(start.deadlineAt).toBeGreaterThan(start.now);

      host.send({ t: "cmds", day: 1, lines: ["TRAIN 1"] });
      // 게스트는 제출하지 않는다 → 마감 알람이 빈 턴으로 해소
      const turn = await guest.waitFor("turn", 40_000);
      expect(turn).toMatchObject({ day: 1, a: ["TRAIN 1"], b: [] });
      host.close();
      guest.close();
    },
  );
});
