// 브라우저-내 봇 백엔드 — Pyodide 워커가 pypy 서브프로세스를 대신한다.
// 프로토콜은 서버 브리지(src/server/botSession.ts)와 동일:
//   READY {side} + 맵 라인들 → "OK" / 결과블록 + "START TURN n" → COMMAND…END / 마지막 FINISH.
// stdin은 SharedArrayBuffer(Atomics)로 워커에 전달 — COOP/COEP 헤더 필요.

import type { MapData } from "@/engine/map";

export interface PyBot {
  id: string;
  nameKo: string;
  file: string;
}
// 정적 배포용 봇 레지스트리 (public/bots/ 의 사본과 1:1)
export const PYODIDE_BOTS: PyBot[] = [
  { id: "latest", nameKo: "Lv.2080", file: "latest.py" },
  { id: "68637", nameKo: "Lv.1805", file: "68637.py" },
];

const SAB_BYTES = 1 << 18; // 256KB — 초기 맵 블록(수 KB)까지 넉넉
const READY_TIMEOUT_MS = 90_000; // WASM 컴파일 + 파이썬 부팅
const OK_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 30_000; // WASM은 pypy보다 느리다 — 서버(5s)보다 넉넉하게

interface Session {
  worker: Worker;
  ctrl: Int32Array;
  data: Uint8Array;
  lines: string[];
  waiters: { resolve: (l: string | null) => void; timer: ReturnType<typeof setTimeout> }[];
  dead: boolean;
  stderrTail: string[];
}

const sessions = new Map<string, Session>();
let seq = 0;
const encoder = new TextEncoder();

export function pyodideSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Worker !== "undefined" &&
    (typeof crossOriginIsolated === "undefined" || crossOriginIsolated === true)
  );
}

function onLine(s: Session, line: string) {
  const w = s.waiters.shift();
  if (w) {
    clearTimeout(w.timer);
    w.resolve(line);
  } else {
    s.lines.push(line);
  }
}

function flushDead(s: Session) {
  s.dead = true;
  for (const w of s.waiters.splice(0)) {
    clearTimeout(w.timer);
    w.resolve(null);
  }
}

function readLine(s: Session, timeoutMs: number): Promise<string | null> {
  const buffered = s.lines.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  if (s.dead) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = s.waiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) s.waiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);
    s.waiters.push({ resolve, timer });
  });
}

async function readCommandBlock(s: Session, timeoutMs: number): Promise<string[] | null> {
  const deadline = Date.now() + timeoutMs;
  const first = await readLine(s, timeoutMs);
  if (first === null || first.trim() !== "COMMAND") return null;
  const out: string[] = [];
  for (;;) {
    const remain = deadline - Date.now();
    if (remain <= 0) return null;
    const line = await readLine(s, remain);
    if (line === null) return null;
    if (line.trim() === "END") return out;
    out.push(line);
  }
}

/** 워커 stdin으로 라인 청크 전송 (턴제라 항상 빈 상태에서 씀) */
function sendChunk(s: Session, text: string) {
  if (s.dead) return;
  const bytes = encoder.encode(text);
  if (bytes.length > s.data.length) throw new Error("stdin 청크가 버퍼보다 큽니다");
  if (Atomics.load(s.ctrl, 0) !== 0) throw new Error("stdin 버퍼가 비워지지 않았습니다");
  s.data.set(bytes, 0);
  Atomics.store(s.ctrl, 1, bytes.length);
  Atomics.store(s.ctrl, 0, 1);
  Atomics.notify(s.ctrl, 0);
}

export async function createPyodideSession(
  botId: string,
  side: "LEFT" | "RIGHT",
  map: MapData,
): Promise<string> {
  const bot = PYODIDE_BOTS.find((b) => b.id === botId);
  if (!bot) throw new Error(`unknown bot: ${botId}`);
  if (!pyodideSupported())
    throw new Error("이 환경에서는 브라우저 봇을 지원하지 않습니다 (SharedArrayBuffer/COOP·COEP 필요)");

  const sab = new SharedArrayBuffer(SAB_BYTES);
  // 모듈 워커 필수 — Pyodide 314+는 클래식 워커(importScripts 환경)를 거부한다.
  // 생성자 별칭 + 런타임 URL로 번들러의 워커 정적 분석도 피한다(public/ 파일을 그대로 로드).
  const WorkerCtor = globalThis.Worker;
  const worker = new WorkerCtor(window.location.origin + "/pyodide-bot-worker.js", { type: "module" });
  const s: Session = {
    worker,
    ctrl: new Int32Array(sab, 0, 2),
    data: new Uint8Array(sab, 8),
    lines: [],
    waiters: [],
    dead: false,
    stderrTail: [],
  };

  let readyResolve!: () => void;
  let readyReject!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; line?: string; message?: string };
    if (m.type === "line") {
      // batched 출력이 여러 줄을 담을 수 있어 안전하게 분해
      for (const ln of String(m.line ?? "").split("\n")) if (ln !== "") onLine(s, ln);
    } else if (m.type === "stderr") {
      s.stderrTail.push(String(m.line ?? ""));
      if (s.stderrTail.length > 40) s.stderrTail.shift();
    } else if (m.type === "ready") {
      readyResolve();
    } else if (m.type === "exit") {
      flushDead(s);
    } else if (m.type === "error") {
      readyReject(new Error(m.message ?? "워커 오류"));
      flushDead(s);
    }
  };
  worker.onerror = (e) => {
    readyReject(new Error(e.message || "워커 로드 실패"));
    flushDead(s);
  };

  worker.postMessage({ type: "init", sab, botUrl: `/bots/${bot.file}`, dataUrl: "/bots/data.bin" });

  const readyTimer = setTimeout(() => readyReject(new Error("봇 준비 시간 초과 (Pyodide 로딩)")), READY_TIMEOUT_MS);
  try {
    await ready;
  } catch (e) {
    worker.terminate();
    throw e;
  } finally {
    clearTimeout(readyTimer);
  }

  // READY 핸드셰이크 — 서버 브리지와 동일한 라인 구성
  const lines = [
    `READY ${side}`,
    `${map.n} ${map.k}`,
    map.x.join(" "),
    map.y.join(" "),
    map.strongholds.join(" "),
  ];
  for (let i = 0; i < map.n; i++) {
    lines.push(`${map.adj[i].length}${map.adj[i].length > 0 ? " " + map.adj[i].join(" ") : ""}`);
  }
  sendChunk(s, lines.join("\n") + "\n");

  const ok = await readLine(s, OK_TIMEOUT_MS);
  if (ok === null || ok.trim() !== "OK") {
    const tail = s.stderrTail.slice(-5).join("\n");
    worker.terminate();
    flushDead(s);
    throw new Error(`봇 핸드셰이크 실패 (OK 미수신)${tail ? `\n${tail}` : ""}`);
  }

  const id = `py-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, s);
  return id;
}

export async function pyodideTurn(
  sessionId: string,
  day: number,
  resultLines: string[],
): Promise<{ commands: string[] } | { timeout: true }> {
  const s = sessions.get(sessionId);
  if (!s || s.dead) throw new Error("세션이 없거나 종료됨");
  sendChunk(s, [...resultLines, `START TURN ${day}`].join("\n") + "\n");
  const block = await readCommandBlock(s, TURN_TIMEOUT_MS);
  if (block === null) return { timeout: true };
  return { commands: block };
}

export function pyodideFinish(sessionId: string, resultLines: string[]): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    if (!s.dead) sendChunk(s, [...resultLines, "FINISH"].join("\n") + "\n");
  } catch {
    // 종료 경로 — 실패해도 무방
  }
  setTimeout(() => {
    s.worker.terminate();
    flushDead(s);
  }, 800);
  sessions.delete(sessionId);
}

export function pyodideKill(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.worker.terminate();
  flushDead(s);
  sessions.delete(sessionId);
}

export function isPyodideSession(sessionId: string): boolean {
  return sessionId.startsWith("py-");
}
