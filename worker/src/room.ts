// RoomDO — Durable Object 셸. WebSocket Hibernation API로 소켓을 유지하고,
// 모든 게임 규칙은 순수 상태기계(roomLogic.step)에 위임한 뒤 effect만 실행한다.
// 저장: "room" 키(히스토리 제외 상태) + "hist:{day}" 키들(값 크기 제한 회피).

import {
  MAX_MSG_BYTES,
  PROTOCOL_V,
  isMapJson,
  isTurnLimit,
  isValidCmds,
  sanitizeNick,
  type ClientMsg,
  type Seat,
  type ServerMsg,
} from "../../src/online/protocol";
import { initialRoom, nextAlarmAt, step, type Effect, type RoomEvent, type RoomState } from "./roomLogic";

interface Attachment {
  seat?: Seat;
}

export class RoomDO {
  private ctx: DurableObjectState;
  private room: RoomState | null = null; // 메모리 캐시 (hibernation 후 lazy 재로딩)

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  /* ── 상태 로드/저장 ── */

  private async load(): Promise<RoomState> {
    if (this.room) return this.room;
    const base = await this.ctx.storage.get<Omit<RoomState, "hist">>("room");
    if (!base) {
      this.room = initialRoom();
      return this.room;
    }
    const histMap = await this.ctx.storage.list<{ day: number; a: string[]; b: string[] }>({ prefix: "hist:" });
    const hist = [...histMap.values()].sort((x, y) => x.day - y.day);
    this.room = { ...base, hist };
    return this.room;
  }

  private async persist(prev: RoomState, next: RoomState): Promise<void> {
    this.room = next;
    const { hist, ...base } = next;
    await this.ctx.storage.put("room", base);
    // hist는 append-only — 새로 늘어난 항목만 기록
    for (let i = prev.hist.length; i < hist.length; i++) {
      const h = hist[i];
      await this.ctx.storage.put(`hist:${String(h.day).padStart(4, "0")}`, h);
    }
  }

  /* ── effect 실행 ── */

  private socketsBySeat(seat: Seat): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.seat === seat);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 이미 닫힌 소켓 — close 이벤트가 정리
    }
  }

  private async runEffects(effects: Effect[]): Promise<void> {
    for (const fx of effects) {
      if (fx.fx === "send") {
        for (const ws of this.socketsBySeat(fx.seat)) this.send(ws, fx.msg);
      } else if (fx.fx === "close") {
        for (const ws of this.socketsBySeat(fx.seat)) {
          try {
            ws.close(fx.code ?? 1000);
          } catch {}
        }
      } else if (fx.fx === "setAlarm") {
        if (fx.at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(fx.at);
      } else if (fx.fx === "delete") {
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(1000);
          } catch {}
        }
        this.room = null;
        await this.ctx.storage.deleteAll(); // 알람도 함께 제거됨
      }
    }
  }

  private async dispatch(ev: RoomEvent): Promise<void> {
    const prev = await this.load();
    const { state, effects } = step(prev, ev);
    // delete가 있으면 persist 불필요 (deleteAll이 정리)
    if (!effects.some((f) => f.fx === "delete")) await this.persist(prev, state);
    await this.runEffects(effects);
  }

  /* ── HTTP: claim + WebSocket 업그레이드 ── */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/claim") {
      const existing = await this.ctx.storage.get("room");
      const claimed = await this.ctx.storage.get<number>("claimed");
      if (existing || claimed) return new Response("taken", { status: 409 });
      await this.ctx.storage.put("claimed", Date.now());
      await this.ctx.storage.put("code", url.searchParams.get("code") ?? "");
      // 클레임만 하고 생성(create)이 안 오는 방도 정리되도록 짧은 알람 예약
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return new Response("ok", { status: 200 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({} satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ── WebSocket 이벤트 (hibernation 핸들러) ── */

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MSG_BYTES) {
      this.send(ws, { t: "err", code: "BAD_MSG" });
      ws.close(1009);
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      this.send(ws, { t: "err", code: "BAD_MSG" });
      return;
    }
    const att = (ws.deserializeAttachment() as Attachment | null) ?? {};
    const now = Date.now();
    const room = await this.load();

    switch (msg.t) {
      case "create": {
        if (msg.v !== PROTOCOL_V) return this.fail(ws, "UNSUPPORTED");
        // create는 반드시 /claim을 거친 DO에서만 (index.ts 호스트 흐름이 claim 후 create).
        // claim 없이 임의 코드 DO에 직접 create를 보내 방을 점유하는 것을 차단.
        if (!(await this.ctx.storage.get("claimed"))) return this.fail(ws, "NO_ROOM");
        if (room.createdAt > 0) return this.fail(ws, "FULL", "이미 생성된 방");
        if (!isMapJson(msg.map) || !isTurnLimit(msg.turnLimit)) return this.fail(ws, "BAD_MSG");
        const code = (await this.ctx.storage.get<string>("code")) ?? ""; // claim 시점에 저장됨
        ws.serializeAttachment({ seat: 0 } satisfies Attachment);
        await this.dispatch({
          e: "create",
          now,
          code,
          nick: sanitizeNick(msg.nick, "플레이어 A"),
          map: msg.map,
          turnLimit: msg.turnLimit,
          token: crypto.randomUUID(),
        });
        return;
      }

      case "join": {
        if (msg.v !== PROTOCOL_V) return this.fail(ws, "UNSUPPORTED");
        if (room.createdAt === 0) return this.fail(ws, "NO_ROOM");
        if (room.joined) return this.fail(ws, "FULL");
        ws.serializeAttachment({ seat: 1 } satisfies Attachment);
        await this.dispatch({
          e: "join",
          now,
          nick: sanitizeNick(msg.nick, "플레이어 B"),
          token: crypto.randomUUID(),
        });
        return;
      }

      case "rejoin": {
        if (msg.v !== PROTOCOL_V) return this.fail(ws, "UNSUPPORTED");
        if (room.createdAt === 0) return this.fail(ws, "NO_ROOM");
        const seat = room.tokens[0] === msg.token ? 0 : room.tokens[1] === msg.token ? 1 : null;
        if (seat === null || msg.token === "") return this.fail(ws, "BAD_TOKEN");
        // 같은 좌석의 기존 소켓은 대체
        for (const old of this.socketsBySeat(seat)) {
          if (old !== ws) {
            this.send(old, { t: "err", code: "SUPERSEDED" });
            try {
              old.close(1000);
            } catch {}
          }
        }
        ws.serializeAttachment({ seat } satisfies Attachment);
        const lastDay = typeof msg.lastDay === "number" && msg.lastDay >= 0 ? Math.floor(msg.lastDay) : 0;
        await this.dispatch({ e: "rejoin", now, seat, lastDay });
        return;
      }

      case "cmds": {
        if (att.seat === undefined) return this.fail(ws, "BAD_MSG", "좌석 미배정");
        if (!isValidCmds(msg)) return this.fail(ws, "BAD_MSG");
        await this.dispatch({ e: "cmds", now, seat: att.seat, day: msg.day, lines: msg.lines });
        return;
      }

      case "finish": {
        if (att.seat === undefined) return;
        if (typeof msg.result !== "string" || msg.result.length > 100 || typeof msg.day !== "number") return;
        await this.dispatch({ e: "finish", now, seat: att.seat, day: msg.day, result: msg.result });
        return;
      }

      case "leave": {
        if (att.seat === undefined) return;
        await this.dispatch({ e: "leave", now, seat: att.seat });
        return;
      }

      default:
        this.send(ws, { t: "err", code: "BAD_MSG" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = (ws.deserializeAttachment() as Attachment | null) ?? {};
    if (att.seat === undefined) return;
    // 같은 좌석의 다른(대체된) 소켓이 살아있으면 끊김으로 치지 않는다
    const remaining = this.socketsBySeat(att.seat).filter((s) => s !== ws);
    if (remaining.length > 0) return;
    await this.dispatch({ e: "close", now: Date.now(), seat: att.seat });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    // 클레임만 되고 생성이 안 된 방 정리
    if (room.createdAt === 0) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.dispatch({ e: "alarm", now: Date.now() });
  }

  private fail(ws: WebSocket, code: Parameters<RoomDO["sendErr"]>[1], msg?: string): void {
    this.sendErr(ws, code, msg);
  }

  private sendErr(
    ws: WebSocket,
    code: "NO_ROOM" | "FULL" | "BAD_TOKEN" | "BAD_DAY" | "BAD_MSG" | "UNSUPPORTED" | "SUPERSEDED" | "ROOM_EXPIRED",
    msg?: string,
  ): void {
    this.send(ws, { t: "err", code, msg });
    try {
      ws.close(1008);
    } catch {}
  }
}
