// 브리지 통합 E2E — dev 서버(localhost:3000)가 떠 있을 때만 실행 (아니면 skip).
// JS 엔진(권위) ↔ 실제 pypy 봇이 API를 통해 30턴 대국.

import { describe, expect, it } from "vitest";
import { generateMap } from "@/engine/mapgen";
import { initState } from "@/engine/state";
import { applyTurn } from "@/engine/turn";
import { botResultBlock } from "@/engine/serialize";
import type { TurnEvents } from "@/engine/events";

const BASE = "http://localhost:3000";

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/bots`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("브리지 E2E (dev 서버 필요)", async () => {
  const up = await serverUp();

  it.skipIf(!up)("샘플 봇과 30턴 프로토콜 왕복 — WA 없음", async () => {
    const map = generateMap({ seed: 99, np: 25 });

    const createRes = await fetch(`${BASE}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId: "sample", side: "RIGHT", map }),
    });
    const created = (await createRes.json()) as { sessionId?: string; error?: string };
    expect(created.sessionId, created.error).toBeTruthy();
    const sid = created.sessionId!;

    let st = initState(map);
    let prevEv: TurnEvents | null = null;
    let botCommandCount = 0;

    for (let day = 1; day <= 30 && !st.result; day++) {
      const rb = prevEv ? botResultBlock(prevEv, 0, 5, 0, 5) : [];
      const turnRes = await fetch(`${BASE}/api/session/${sid}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, resultLines: rb }),
      });
      const turn = (await turnRes.json()) as { commands?: string[]; timeout?: boolean; error?: string };
      expect(turn.timeout, `day ${day}: 봇 타임아웃`).not.toBe(true);
      expect(turn.commands, `day ${day}: ${turn.error}`).toBeTruthy();
      botCommandCount += turn.commands!.length;

      const { state, events } = applyTurn(map, st, [[], turn.commands!]);
      st = state;
      prevEv = events;
    }

    // 봇이 실제로 뭔가 했고, WA도 없었다
    expect(botCommandCount).toBeGreaterThan(0);
    expect(st.result?.reason).not.toBe("WA");

    await fetch(`${BASE}/api/session/${sid}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultLines: prevEv ? botResultBlock(prevEv, 0, 5, 0, 5) : [] }),
    });
  }, 60000);

  it.skipIf(!up)("latest 봇 세션 생성·첫 턴 응답", async () => {
    const map = generateMap({ seed: 5, np: 25 });
    const createRes = await fetch(`${BASE}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId: "latest", side: "LEFT", map }),
    });
    const created = (await createRes.json()) as { sessionId?: string; error?: string };
    expect(created.sessionId, created.error).toBeTruthy();
    const sid = created.sessionId!;

    const turnRes = await fetch(`${BASE}/api/session/${sid}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: 1, resultLines: [] }),
    });
    const turn = (await turnRes.json()) as { commands?: string[]; timeout?: boolean };
    expect(turn.timeout).not.toBe(true);
    expect(Array.isArray(turn.commands)).toBe(true);

    await fetch(`${BASE}/api/session/${sid}/finish`, { method: "DELETE" });
  }, 30000);
});
