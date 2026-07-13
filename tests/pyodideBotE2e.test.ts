// Pyodide 봇 E2E — 브라우저 배포판과 동일한 구조(SAB stdin + 워커)로
// 실제 봇(latest.py)이 Python-WASM 위에서 프로토콜 왕복이 되는지 검증.
// 게임 진행은 진짜 TS 엔진이 담당한다 (봇 명령 → applyTurn → 결과블록 회신).

import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateMap } from "@/engine/mapgen";
import { initState } from "@/engine/state";
import { applyTurn } from "@/engine/turn";
import { botResultBlock } from "@/engine/serialize";
import type { TurnEvents } from "@/engine/events";

const dataBinPath = fileURLToPath(new URL("../public/bots/data.bin", import.meta.url));
const workerPath = fileURLToPath(new URL("./helpers/pyodideNodeWorker.mjs", import.meta.url));
const hasPyodide = existsSync(fileURLToPath(new URL("../node_modules/pyodide/pyodide.mjs", import.meta.url)));

const SAB_BYTES = 1 << 18;
const encoder = new TextEncoder();

interface Chan {
  lines: string[];
  waiters: ((l: string | null) => void)[];
  dead: boolean;
}

function makeSession(botPath: string) {
  const sab = new SharedArrayBuffer(SAB_BYTES);
  const ctrl = new Int32Array(sab, 0, 2);
  const data = new Uint8Array(sab, 8);
  const chan: Chan = { lines: [], waiters: [], dead: false };
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));

  const worker = new Worker(workerPath, { workerData: { sab, botPath, dataBinPath } });
  worker.on("message", (m: { type: string; line?: string; message?: string }) => {
    if (m.type === "line") {
      for (const ln of String(m.line ?? "").split("\n")) {
        if (ln === "") continue;
        const w = chan.waiters.shift();
        if (w) w(ln);
        else chan.lines.push(ln);
      }
    } else if (m.type === "ready") readyResolve();
    else if (m.type === "error" || m.type === "exit") {
      chan.dead = true;
      for (const w of chan.waiters.splice(0)) w(null);
      if (m.type === "error") console.error("worker error:", m.message);
    }
  });

  const send = (text: string) => {
    const bytes = encoder.encode(text);
    if (Atomics.load(ctrl, 0) !== 0) throw new Error("stdin busy");
    data.set(bytes, 0);
    Atomics.store(ctrl, 1, bytes.length);
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
  };
  const readLine = (timeoutMs: number): Promise<string | null> => {
    const buffered = chan.lines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (chan.dead) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = chan.waiters.indexOf(wrapped);
        if (i >= 0) chan.waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      const wrapped = (l: string | null) => {
        clearTimeout(timer);
        resolve(l);
      };
      chan.waiters.push(wrapped);
    });
  };
  const readCommandBlock = async (timeoutMs: number): Promise<string[] | null> => {
    const deadline = Date.now() + timeoutMs;
    const first = await readLine(timeoutMs);
    if (first === null || first.trim() !== "COMMAND") return null;
    const out: string[] = [];
    for (;;) {
      const remain = deadline - Date.now();
      if (remain <= 0) return null;
      const line = await readLine(remain);
      if (line === null) return null;
      if (line.trim() === "END") return out;
      out.push(line);
    }
  };

  return { worker, ready, send, readLine, readCommandBlock };
}

describe.skipIf(!hasPyodide)("Pyodide 봇 E2E (WASM)", () => {
  it.each(["latest.py", "68637.py"])(
    "%s가 Pyodide에서 핸드셰이크 + 10턴 왕복 (WA 없음)",
    async (botFile) => {
      const botPath = fileURLToPath(new URL(`../public/bots/${botFile}`, import.meta.url));
      const map = generateMap({ seed: 7, np: 25 });
      let st = initState(map);
      const s = makeSession(botPath);
      try {
        await s.ready;

        // READY 핸드셰이크 (서버 브리지와 동일 라인)
        const lines = [`READY LEFT`, `${map.n} ${map.k}`, map.x.join(" "), map.y.join(" "), map.strongholds.join(" ")];
        for (let i = 0; i < map.n; i++) {
          lines.push(`${map.adj[i].length}${map.adj[i].length > 0 ? " " + map.adj[i].join(" ") : ""}`);
        }
        s.send(lines.join("\n") + "\n");
        const ok = await s.readLine(60_000);
        expect(ok?.trim()).toBe("OK");

        // 10턴: 봇(LEFT) 명령 → 엔진 해소 → 결과블록 회신
        let prevEv: TurnEvents | null = null;
        for (let day = 1; day <= 10; day++) {
          const rb = prevEv ? botResultBlock(prevEv, 0, 5, 0, 5) : [];
          s.send([...rb, `START TURN ${day}`].join("\n") + "\n");
          const commands = await s.readCommandBlock(60_000);
          expect(commands, `day ${day} 명령 미수신`).not.toBeNull();

          const { state: next, events } = applyTurn(map, st, [commands!, []]);
          expect(events.wa, `day ${day}에 봇 WA: ${JSON.stringify(events.wa)}`).toBeNull();
          st = next;
          prevEv = events;
        }

        // 종료 통보
        const rb = prevEv ? botResultBlock(prevEv, 0, 5, 0, 5) : [];
        s.send([...rb, "FINISH"].join("\n") + "\n");
      } finally {
        await s.worker.terminate();
      }
    },
    180_000,
  );
});
