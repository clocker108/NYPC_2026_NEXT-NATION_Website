// 봇 세션 매니저 — pypy3 서브프로세스 스폰 + 라인 파이프.
// 브라우저의 JS 엔진이 게임의 권위이고, 여기는 프로토콜 파이프일 뿐이다.
// 세션은 globalThis에 캐싱 (Next dev HMR로 모듈 상태가 초기화돼도 생존).

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { botById, botsDir } from "./bots";

const IDLE_KILL_MS = 10 * 60 * 1000;

type Proc = ChildProcessByStdio<Writable, Readable, Readable>;

class BotSession {
  id: string;
  proc: Proc;
  private lines: string[] = [];
  private waiters: { resolve: (l: string | null) => void; timer: NodeJS.Timeout }[] = [];
  lastUsed = Date.now();
  dead = false;
  stderrTail: string[] = [];

  constructor(cmd: string, args: string[], cwd: string) {
    this.id = randomUUID();
    this.proc = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const w = this.waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        w.resolve(line);
      } else {
        this.lines.push(line);
      }
    });
    const rlErr = createInterface({ input: this.proc.stderr });
    rlErr.on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    this.proc.on("exit", () => {
      this.dead = true;
      for (const w of this.waiters.splice(0)) {
        clearTimeout(w.timer);
        w.resolve(null);
      }
    });
  }

  send(line: string): void {
    this.lastUsed = Date.now();
    if (!this.dead) this.proc.stdin.write(line + "\n");
  }

  readLine(timeoutMs: number): Promise<string | null> {
    this.lastUsed = Date.now();
    const buffered = this.lines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.dead) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ resolve, timer });
    });
  }

  /** COMMAND ... END 블록 읽기. 실패/타임아웃 시 null. */
  async readCommandBlock(timeoutMs: number): Promise<string[] | null> {
    const deadline = Date.now() + timeoutMs;
    const first = await this.readLine(timeoutMs);
    if (first === null || first.trim() !== "COMMAND") return null;
    const out: string[] = [];
    for (;;) {
      const remain = deadline - Date.now();
      if (remain <= 0) return null;
      const line = await this.readLine(remain);
      if (line === null) return null;
      if (line.trim() === "END") return out;
      out.push(line);
    }
  }

  kill(): void {
    this.dead = true;
    try {
      this.proc.stdin.end();
    } catch {}
    try {
      this.proc.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        this.proc.kill("SIGKILL");
      } catch {}
    }, 1500);
  }
}

// globalThis 캐싱 (HMR 생존)
interface SessionGlobal {
  __botSessions?: Map<string, BotSession>;
  __botJanitor?: NodeJS.Timeout;
}
const g = globalThis as SessionGlobal;
if (!g.__botSessions) g.__botSessions = new Map();
const sessions = g.__botSessions;
if (!g.__botJanitor) {
  g.__botJanitor = setInterval(() => {
    for (const [id, s] of sessions) {
      if (Date.now() - s.lastUsed > IDLE_KILL_MS || s.dead) {
        s.kill();
        sessions.delete(id);
      }
    }
  }, 60 * 1000);
  g.__botJanitor.unref?.();
}

export interface MapPayload {
  n: number;
  k: number;
  x: number[];
  y: number[];
  strongholds: number[];
  adj: number[][];
}

/** 세션 생성: 봇 스폰 → READY 핸드셰이크 → OK 확인 */
export async function createSession(
  botId: string,
  side: "LEFT" | "RIGHT",
  map: MapPayload,
): Promise<{ sessionId: string } | { error: string }> {
  const bot = botById(botId);
  if (!bot) return { error: `unknown bot: ${botId}` };

  // pypy3 우선, 없으면 python3
  let session: BotSession | null = null;
  for (const runtime of ["pypy3", "python3"]) {
    try {
      const s = new BotSession(runtime, [bot.file], botsDir());
      // spawn 에러는 비동기 — 짧게 대기해 즉사 감지
      await new Promise((r) => setTimeout(r, 120));
      if (!s.dead) {
        session = s;
        break;
      }
    } catch {
      // try next runtime
    }
  }
  if (!session) return { error: "봇 프로세스를 시작할 수 없습니다 (pypy3/python3 필요)" };

  session.send(`READY ${side}`);
  session.send(`${map.n} ${map.k}`);
  session.send(map.x.join(" "));
  session.send(map.y.join(" "));
  session.send(map.strongholds.join(" "));
  for (let i = 0; i < map.n; i++) {
    session.send(`${map.adj[i].length}${map.adj[i].length > 0 ? " " + map.adj[i].join(" ") : ""}`);
  }

  const ok = await session.readLine(15000); // PyPy 웜업 여유
  if (ok === null || ok.trim() !== "OK") {
    const tail = session.stderrTail.slice(-5).join("\n");
    session.kill();
    return { error: `봇 핸드셰이크 실패 (OK 미수신)${tail ? `\n${tail}` : ""}` };
  }

  sessions.set(session.id, session);
  return { sessionId: session.id };
}

/** 턴 교환: 직전 결과블록 전달 → START TURN → 봇 명령 수신 */
export async function exchangeTurn(
  sessionId: string,
  day: number,
  resultLines: string[],
): Promise<{ commands: string[] } | { timeout: true } | { error: string }> {
  const s = sessions.get(sessionId);
  if (!s || s.dead) return { error: "세션이 없거나 종료됨" };
  for (const line of resultLines) s.send(line);
  s.send(`START TURN ${day}`);
  const block = await s.readCommandBlock(5000);
  if (block === null) {
    return { timeout: true };
  }
  return { commands: block };
}

/** 게임 종료: 최종 결과블록 + FINISH 전송 후 정리 */
export function finishSession(sessionId: string, resultLines: string[]): { ok: boolean } {
  const s = sessions.get(sessionId);
  if (!s) return { ok: true };
  for (const line of resultLines) s.send(line);
  s.send("FINISH");
  setTimeout(() => {
    s.kill();
    sessions.delete(sessionId);
  }, 500);
  return { ok: true };
}

export function killSession(sessionId: string): { ok: boolean } {
  const s = sessions.get(sessionId);
  if (s) {
    s.kill();
    sessions.delete(sessionId);
  }
  return { ok: true };
}
