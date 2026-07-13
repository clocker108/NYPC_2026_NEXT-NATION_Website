// 인터넷 대전 프로토콜 — 클라이언트(브라우저)와 워커(Cloudflare DO)가 공유하는
// 메시지 계약. 워커는 상대경로(../../src/online/protocol)로 import한다.
// 게임 상태는 절대 전송하지 않는다 — 명령 라인 쌍만 중계하는 락스텝 설계.

export const PROTOCOL_V = 1;

export type TurnLimit = 0 | 30 | 60 | 120; // 초 (0 = 제한 없음)

// MapData와 동일 구조 (JSON-safe) — 워커가 엔진을 import하지 않도록 별도 정의
export interface MapJson {
  n: number;
  k: number;
  x: number[];
  y: number[];
  strongholds: number[];
  adj: number[][];
}

/* ── 클라이언트 → 서버 ── */
export type ClientMsg =
  | { t: "create"; v: number; nick: string; map: MapJson; turnLimit: TurnLimit }
  | { t: "join"; v: number; nick: string }
  | { t: "rejoin"; v: number; token: string; lastDay: number }
  | { t: "cmds"; day: number; lines: string[] }
  | { t: "finish"; day: number; result: string } // 클라 계산 엔진 결과 (예: "RESULT LEFT_WIN HQ_DESTROYED")
  | { t: "leave" };

/* ── 서버 → 클라이언트 ── */
export type Seat = 0 | 1; // 0 = 호스트(A/빨강), 1 = 입장자(B/파랑)

export type ErrCode =
  | "NO_ROOM"
  | "FULL"
  | "BAD_TOKEN"
  | "BAD_DAY"
  | "BAD_MSG"
  | "UNSUPPORTED"
  | "SUPERSEDED"
  | "ROOM_EXPIRED";

export type ServerMsg =
  | { t: "created"; code: string; token: string; seat: 0 }
  | {
      t: "start";
      map: MapJson;
      nicks: [string, string];
      seat: Seat;
      turnLimit: TurnLimit;
      token?: string; // 입장자에게만 (호스트는 created에서 수령)
      deadlineAt?: number;
      now: number;
    }
  | { t: "peer_submitted"; day: number }
  | { t: "turn"; day: number; a: string[]; b: string[]; deadlineAt?: number; now: number }
  | { t: "peer_down"; graceUntil: number; now: number }
  | { t: "peer_up" }
  | {
      t: "resume";
      phase: "lobby" | "playing";
      code: string;
      seat: Seat;
      map: MapJson;
      nicks: [string, string];
      turnLimit: TurnLimit;
      missed: { day: number; a: string[]; b: string[] }[];
      youSubmitted: boolean;
      peerSubmitted: boolean;
      peerConnected: boolean;
      deadlineAt?: number;
      now: number;
    }
  | { t: "finish"; result: string } // FORFEIT 포함: "RESULT LEFT_WIN FORFEIT"
  | { t: "err"; code: ErrCode; msg?: string };

/* ── 크기 가드 (서버는 내용 검증 안 함 — 부정 라인은 엔진 WA로 양측 동일 판정) ── */
export const MAX_MSG_BYTES = 256 * 1024;
export const MAX_CMD_LINES = 2000;
// 서버측 하드 day 상한 — 엔진은 200일에 반드시 종료되므로 그 이상은 오작동/악용.
// 이 상한이 hist 키(day별) 무한 증가를 막는다 (서버엔 엔진이 없어 자연 종료를 신뢰만 함).
export const MAX_DAY = 250;
export const MAX_NICK_LEN = 12;
export const GRACE_MS = 2 * 60 * 1000; // 끊김 후 재접속 유예
export const LOBBY_TTL_MS = 30 * 60 * 1000;
export const PLAYING_TTL_MS = 6 * 60 * 60 * 1000;
export const FINISHED_TTL_MS = 5 * 60 * 1000;

export function isValidCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

export function sanitizeNick(nick: unknown, fallback: string): string {
  const s = typeof nick === "string" ? nick.trim().slice(0, MAX_NICK_LEN) : "";
  return s || fallback;
}

export function isMapJson(m: unknown): m is MapJson {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  if (typeof o.n !== "number" || !Number.isInteger(o.n) || o.n < 51 || o.n > 109) return false;
  const n = o.n;
  if (typeof o.k !== "number" || !Number.isInteger(o.k)) return false;
  // 좌표는 유한 실수여야 (NaN/Infinity면 거리·경로 계산이 오염됨)
  const finiteArr = (a: unknown) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === "number" && Number.isFinite(v));
  if (!finiteArr(o.x) || !finiteArr(o.y)) return false;
  // adj: n행, 각 원소는 [0,n) 범위 정수 인덱스여야 (상대가 보낸 맵의 OOB 인덱스로 엔진이 깨지지 않게)
  if (!Array.isArray(o.adj) || o.adj.length !== n) return false;
  const inRangeIdx = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n;
  if (!(o.adj as unknown[]).every((row) => Array.isArray(row) && row.every(inRangeIdx))) return false;
  // 거점: [0,n) 범위 정수, 서로 다르고, 본부(0·n-1)가 아니어야
  if (!Array.isArray(o.strongholds)) return false;
  const sh = o.strongholds as unknown[];
  if (!sh.every((v) => inRangeIdx(v) && v !== 0 && v !== n - 1)) return false;
  if (new Set(sh).size !== sh.length) return false;
  return true;
}

export function isValidCmds(msg: { day?: unknown; lines?: unknown }): boolean {
  return (
    typeof msg.day === "number" &&
    Number.isInteger(msg.day) &&
    msg.day >= 1 &&
    Array.isArray(msg.lines) &&
    msg.lines.length <= MAX_CMD_LINES &&
    msg.lines.every((l) => typeof l === "string" && l.length <= 200)
  );
}

export function isTurnLimit(v: unknown): v is TurnLimit {
  return v === 0 || v === 30 || v === 60 || v === 120;
}
