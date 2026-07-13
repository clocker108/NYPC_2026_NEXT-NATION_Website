// 인터넷 대전 브라우저 클라이언트 — WS 연결 수명·자동 재접속을 관리하고
// 서버 메시지를 스토어 핸들러로 넘긴다. 게임 규칙은 전혀 모른다(락스텝 중계만).
// 세션은 sessionStorage(탭 단위)에 저장해 새로고침 후 재접속을 지원한다.

import { GRACE_MS, PROTOCOL_V, type MapJson, type Seat, type ServerMsg, type TurnLimit } from "./protocol";
import { WS_URL } from "./config";

export interface OnlineSession {
  code: string;
  token: string;
  seat: Seat;
  nick: string;
}

const SESSION_KEY = "nn-online-session";

export function loadSession(): OnlineSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as OnlineSession;
    return s.code && s.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: OnlineSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {}
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

export interface StartInfo {
  map: MapJson;
  nicks: [string, string];
  seat: Seat;
  turnLimit: TurnLimit;
  deadline: number | null; // 로컬 시계 기준으로 환산됨
}

export interface ResumeInfo extends StartInfo {
  phase: "lobby" | "playing";
  missed: { day: number; a: string[]; b: string[] }[];
  youSubmitted: boolean;
  peerSubmitted: boolean;
  peerConnected: boolean;
}

export interface OnlineHandlers {
  onStart: (info: StartInfo) => void;
  onTurn: (day: number, a: string[], b: string[], deadline: number | null) => void;
  onPeerSubmitted: (day: number) => void;
  onPeerDown: (graceUntil: number) => void; // 로컬 시계 기준
  onPeerUp: () => void;
  onSelfDown: () => void;
  onSelfUp: (info: ResumeInfo) => void;
  onFinish: (result: string) => void;
  /** 복구 불가 오류 (BAD_TOKEN·NO_ROOM 등) — 세션 종료 처리 */
  onFatal: (code: string, msg?: string) => void;
}

/** 서버 시계 → 로컬 시계 환산 */
function toLocal(at: number | undefined, serverNow: number): number | null {
  if (at === undefined) return null;
  return Date.now() + (at - serverNow);
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private handlers: OnlineHandlers;
  private session: OnlineSession | null = null;
  private getLastDay: () => number;
  private destroyed = false;
  private finished = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private downSince: number | null = null;

  constructor(handlers: OnlineHandlers, getLastDay: () => number) {
    this.handlers = handlers;
    this.getLastDay = getLastDay;
  }

  /* ── 연결 열기 ── */

  private open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error("서버 연결 시간 초과"));
      }, 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("서버에 연결할 수 없습니다"));
      });
    });
  }

  private attach(ws: WebSocket): void {
    // open()과 attach() 사이에 destroy/leave가 났으면 새 소켓을 붙이지 말고 정리 (재접속 중 누수 방지)
    if (this.destroyed || this.finished) {
      try {
        ws.close();
      } catch {}
      return;
    }
    this.ws = ws;
    ws.addEventListener("message", (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMsg));
    ws.addEventListener("close", () => {
      // 핸드셰이크(created/start/resume) 대기 중 소켓이 err 없이 닫히면 15초 타임아웃 대신 즉시 실패
      if (this.once) this.failHandshake(new Error("서버와의 연결이 끊겼습니다"));
      this.onClose(ws);
    });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /* ── 호스트/입장 플로우 ── */

  /** 방 생성 — created 수신 시 {code} 반환. start는 핸들러로 온다(상대 입장 대기). */
  async host(nick: string, map: MapJson, turnLimit: TurnLimit): Promise<{ code: string }> {
    const ws = await this.open(`${WS_URL}/ws?role=host`);
    this.attach(ws);
    this.send({ t: "create", v: PROTOCOL_V, nick, map, turnLimit });
    const created = await this.waitOnce("created", 15_000);
    this.session = { code: created.code, token: created.token, seat: 0, nick };
    saveSession(this.session);
    return { code: created.code };
  }

  /** 방 입장 — start 수신까지 대기 후 정보 반환 (핸들러 onStart도 함께 호출됨) */
  async join(nick: string, code: string): Promise<StartInfo> {
    const ws = await this.open(`${WS_URL}/ws?role=join&code=${code}`);
    this.attach(ws);
    this.send({ t: "join", v: PROTOCOL_V, nick });
    const start = await this.waitOnce("start", 15_000);
    this.session = { code, token: start.token ?? "", seat: start.seat, nick };
    saveSession(this.session);
    return {
      map: start.map,
      nicks: start.nicks,
      seat: start.seat,
      turnLimit: start.turnLimit,
      deadline: toLocal(start.deadlineAt, start.now),
    };
  }

  /** 저장된 세션으로 재접속 (새로고침 복구) — resume 수신까지 대기 */
  async rejoin(session: OnlineSession): Promise<ResumeInfo> {
    this.session = session;
    const ws = await this.open(`${WS_URL}/ws?role=rejoin&code=${session.code}`);
    this.attach(ws);
    this.send({ t: "rejoin", v: PROTOCOL_V, token: session.token, lastDay: this.getLastDay() });
    const resume = await this.waitOnce("resume", 15_000);
    return this.resumeInfo(resume);
  }

  private resumeInfo(resume: Extract<ServerMsg, { t: "resume" }>): ResumeInfo {
    return {
      phase: resume.phase,
      map: resume.map,
      nicks: resume.nicks,
      seat: resume.seat,
      turnLimit: resume.turnLimit,
      deadline: toLocal(resume.deadlineAt, resume.now),
      missed: resume.missed,
      youSubmitted: resume.youSubmitted,
      peerSubmitted: resume.peerSubmitted,
      peerConnected: resume.peerConnected,
    };
  }

  /** 특정 타입 1회 대기 (실패/err/소켓 close 시 reject) — 초기 핸드셰이크 전용 */
  private waitOnce<T extends ServerMsg["t"]>(t: T, timeoutMs: number): Promise<Extract<ServerMsg, { t: T }>> {
    return new Promise((resolve, reject) => {
      const done = () => {
        if (this.onceTimer) clearTimeout(this.onceTimer);
        this.onceTimer = null;
        this.once = null;
        this.onceReject = null;
      };
      this.onceTimer = setTimeout(() => {
        done();
        reject(new Error("서버 응답 시간 초과"));
      }, timeoutMs);
      this.onceReject = (e: Error) => {
        done();
        reject(e);
      };
      this.once = (msg) => {
        if (msg.t === t) {
          done();
          resolve(msg as Extract<ServerMsg, { t: T }>);
          return true;
        }
        if (msg.t === "err") {
          const err = new Error(errText(msg.code, msg.msg));
          done();
          reject(err);
          return true;
        }
        return false;
      };
    });
  }

  /** 핸드셰이크 대기 중 소켓 close/error 시 그 프로미스를 즉시 실패시킨다 */
  private failHandshake(e: Error): void {
    this.onceReject?.(e);
  }

  private once: ((msg: ServerMsg) => boolean) | null = null;
  private onceReject: ((e: Error) => void) | null = null;
  private onceTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── 수신 라우팅 ── */

  private onMessage(msg: ServerMsg): void {
    if (this.destroyed) return;
    if (this.once && this.once(msg)) return;
    const h = this.handlers;
    switch (msg.t) {
      case "start":
        h.onStart({
          map: msg.map,
          nicks: msg.nicks,
          seat: msg.seat,
          turnLimit: msg.turnLimit,
          deadline: toLocal(msg.deadlineAt, msg.now),
        });
        if (this.session && msg.token) {
          this.session = { ...this.session, token: msg.token, seat: msg.seat };
          saveSession(this.session);
        }
        return;
      case "turn":
        h.onTurn(msg.day, msg.a, msg.b, toLocal(msg.deadlineAt, msg.now));
        return;
      case "peer_submitted":
        h.onPeerSubmitted(msg.day);
        return;
      case "peer_down":
        h.onPeerDown(toLocal(msg.graceUntil, msg.now) ?? Date.now() + GRACE_MS);
        return;
      case "peer_up":
        h.onPeerUp();
        return;
      case "resume":
        h.onSelfUp(this.resumeInfo(msg));
        return;
      case "finish":
        this.finished = true;
        clearSession();
        h.onFinish(msg.result);
        return;
      case "err":
        if (msg.code === "SUPERSEDED") return; // 다른 탭/재접속으로 대체됨 — 새 소켓이 이어받음
        this.finished = true;
        clearSession();
        h.onFatal(msg.code, msg.msg);
        return;
      case "created":
        return; // waitOnce에서만 소비
    }
  }

  /* ── 끊김 → 자동 재접속 (grace 안에서 백오프) ── */

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return; // 대체된 구 소켓
    this.ws = null;
    if (this.destroyed || this.finished || !this.session) return;
    if (this.downSince === null) {
      this.downSince = Date.now();
      this.handlers.onSelfDown();
    }
    this.scheduleReconnect(1000);
  }

  private scheduleReconnect(delay: number): void {
    if (this.destroyed || this.finished || !this.session) return;
    if (Date.now() - (this.downSince ?? 0) > GRACE_MS) {
      this.handlers.onFatal("ROOM_EXPIRED", "재접속 유예가 지났습니다");
      clearSession();
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed || this.finished || !this.session) return;
      try {
        const info = await this.rejoin(this.session);
        this.downSince = null;
        this.handlers.onSelfUp(info);
      } catch {
        this.scheduleReconnect(Math.min(delay * 2, 10_000));
      }
    }, delay);
  }

  /* ── 송신 API ── */

  submit(day: number, lines: string[]): void {
    this.send({ t: "cmds", day, lines });
  }

  sendFinish(day: number, result: string): void {
    this.finished = true;
    clearSession();
    this.send({ t: "finish", day, result });
  }

  leave(): void {
    this.finished = true;
    clearSession();
    this.send({ t: "leave" });
    this.destroy();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}

export function errText(code: string, msg?: string): string {
  const table: Record<string, string> = {
    NO_ROOM: "존재하지 않는 방 번호입니다",
    FULL: "이미 대전이 시작된 방입니다",
    BAD_TOKEN: "세션이 만료됐습니다",
    ROOM_EXPIRED: "방이 만료됐습니다",
    UNSUPPORTED: "클라이언트 버전이 서버와 맞지 않습니다 — 새로고침해 주세요",
  };
  return table[code] ?? msg ?? `연결 오류 (${code})`;
}
