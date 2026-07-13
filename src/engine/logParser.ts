// testing-tool.py가 -l 로 쓰는 대전 로그 파서.
// 형식: [LEFT "..."] [RIGHT "..."] 헤더 → MAP..END MAP → 턴 블록 반복 → RESULT 라인.

import type { MapData } from "./map";

export interface ParsedTurn {
  day: number;
  cmds: [string[], string[]]; // LEFT, RIGHT 원시 제출 라인
  resultLines: string[]; // TIME 제외한 결과 라인들 (없으면 WA로 끊긴 턴)
  hasResult: boolean;
}

export interface ParsedLog {
  names: [string, string];
  map: MapData;
  turns: ParsedTurn[];
  finalResult: string | null; // "RESULT LEFT_WIN HQ_DESTROYED" 등
}

export function parseLog(text: string): ParsedLog {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const names: [string, string] = ["LEFT", "RIGHT"];

  const peek = () => (i < lines.length ? lines[i] : null);
  const next = () => lines[i++];

  // 헤더/디버그 라인 스킵
  while (i < lines.length) {
    const ln = peek()!;
    if (ln.startsWith("[LEFT ")) {
      const mName = ln.match(/^\[LEFT\s+"(.*)"\]$/);
      if (mName) names[0] = mName[1] || "LEFT";
      next();
    } else if (ln.startsWith("[RIGHT ")) {
      const mName = ln.match(/^\[RIGHT\s+"(.*)"\]$/);
      if (mName) names[1] = mName[1] || "RIGHT";
      next();
    } else if (ln.startsWith("#") || ln.trim() === "") {
      next();
    } else {
      break;
    }
  }

  if (next() !== "MAP") throw new Error("expected MAP block");
  const [nStr, kStr] = next().trim().split(/\s+/);
  const n = parseInt(nStr, 10);
  const k = parseInt(kStr, 10);
  const x = next().trim().split(/\s+/).map(Number);
  const y = next().trim().split(/\s+/).map(Number);
  const shLine = next().trim();
  if (!shLine.startsWith("STRONGHOLDS")) throw new Error("expected STRONGHOLDS line");
  const strongholds = shLine.split(/\s+/).slice(1).map(Number);
  const adj: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row = next().trim().split(/\s+/).map(Number);
    const deg = row[0];
    adj.push(row.slice(1, 1 + deg).sort((a, b) => a - b));
  }
  if (next() !== "END MAP") throw new Error("expected END MAP");

  const map: MapData = { n, k, x, y, strongholds, adj };

  const turns: ParsedTurn[] = [];
  let finalResult: string | null = null;

  while (i < lines.length) {
    const ln = peek();
    if (ln === null) break;
    if (ln.startsWith("# Debug") || ln.trim() === "") {
      next();
      continue;
    }
    if (ln.startsWith("RESULT ")) {
      finalResult = next().trim();
      break;
    }
    const turnMatch = ln.match(/^TURN (\d+)$/);
    if (!turnMatch) throw new Error(`unexpected line at ${i}: ${ln}`);
    next();
    const day = parseInt(turnMatch[1], 10);

    const cmds: [string[], string[]] = [[], []];
    for (const [sideIdx, sideName] of [[0, "LEFT"], [1, "RIGHT"]] as const) {
      // 디버그 라인이 사이에 낄 수 있음
      while (peek()?.startsWith("# Debug")) next();
      if (next() !== `COMMAND ${sideName} START`) throw new Error(`expected COMMAND ${sideName} START (day ${day})`);
      while (peek() !== `COMMAND ${sideName} END`) {
        const c = next();
        if (c === undefined) throw new Error(`unterminated COMMAND ${sideName} block (day ${day})`);
        if (c.startsWith("# Debug")) continue;
        cmds[sideIdx].push(c);
      }
      next(); // COMMAND <side> END
    }

    while (peek()?.startsWith("# Debug")) next();

    // 결과 블록 (WA로 끊긴 턴은 결과 없이 RESULT로 감)
    let hasResult = false;
    const resultLines: string[] = [];
    if (peek() === `TURN ${day} RESULT`) {
      next();
      hasResult = true;
      while (peek() !== `END TURN ${day}`) {
        const r = next();
        if (r === undefined) throw new Error(`unterminated TURN ${day} RESULT`);
        if (r.startsWith("# Debug")) continue;
        if (r.startsWith("TIME ")) continue; // 재현 불가 값 — diff 제외
        resultLines.push(r);
      }
      next(); // END TURN d
    }
    turns.push({ day, cmds, resultLines, hasResult });
  }

  return { names, map, turns, finalResult };
}
