// 브리지 클라이언트 — 백엔드 이중화:
//   ① Pyodide 백엔드 (브라우저-내 Python WASM) — **기본값**. 배포 목적지(Cloudflare
//     Pages)가 정적 호스팅이라 로컬 dev·?local(오프라인 모드)도 같은 경로를 쓴다.
//   ② 서버 브리지 (Next API Routes → pypy 서브프로세스) — Pyodide 불가 브라우저
//     (SharedArrayBuffer 미지원) 폴백 + bridgeE2e 테스트 전용.
// 세션 id 접두사("py-")로 이후 호출을 올바른 백엔드로 라우팅한다.

import type { MapData } from "@/engine/map";
import {
  PYODIDE_BOTS,
  createPyodideSession,
  isPyodideSession,
  pyodideFinish,
  pyodideKill,
  pyodideSupported,
  pyodideTurn,
} from "./pyodideBackend";

let activeBackend: "server" | "pyodide" = "pyodide";

async function fetchServerBots(): Promise<{ id: string; nameKo: string }[] | null> {
  try {
    const res = await fetch("/api/bots");
    if (!res.ok) return null;
    const j = (await res.json()) as { bots: { id: string; nameKo: string }[] };
    return j.bots;
  } catch {
    return null; // 정적 배포 등 서버 브리지 없음
  }
}

export async function fetchBots(): Promise<{ id: string; nameKo: string }[]> {
  if (!pyodideSupported()) {
    // 구형 브라우저 등 Pyodide 불가 환경 — 서버 브리지가 있으면 그걸로라도
    const bots = await fetchServerBots();
    if (bots) {
      activeBackend = "server";
      return bots;
    }
    throw new Error("이 브라우저에서는 인공지능 대전을 사용할 수 없습니다 (SharedArrayBuffer 미지원)");
  }
  activeBackend = "pyodide";
  return PYODIDE_BOTS.map(({ id, nameKo }) => ({ id, nameKo }));
}

export async function createBridgeSession(
  botId: string,
  side: "LEFT" | "RIGHT",
  map: MapData,
): Promise<string> {
  if (activeBackend === "pyodide") return createPyodideSession(botId, side, map);
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botId, side, map }),
  });
  const j = (await res.json()) as { sessionId?: string; error?: string };
  if (!res.ok || !j.sessionId) throw new Error(j.error ?? "세션 생성 실패");
  return j.sessionId;
}

export async function bridgeTurn(
  sessionId: string,
  day: number,
  resultLines: string[],
): Promise<{ commands: string[] } | { timeout: true }> {
  if (isPyodideSession(sessionId)) return pyodideTurn(sessionId, day, resultLines);
  const res = await fetch(`/api/session/${sessionId}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day, resultLines }),
  });
  const j = (await res.json()) as { commands?: string[]; timeout?: boolean; error?: string };
  if (j.timeout) return { timeout: true };
  if (!res.ok || !j.commands) throw new Error(j.error ?? "턴 교환 실패");
  return { commands: j.commands };
}

export async function bridgeFinish(sessionId: string, resultLines: string[]): Promise<void> {
  if (isPyodideSession(sessionId)) {
    pyodideFinish(sessionId, resultLines);
    return;
  }
  await fetch(`/api/session/${sessionId}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultLines }),
  }).catch(() => {});
}

/** 게임 중단(메뉴 복귀 등) — 결과 없이 세션만 정리 */
export async function bridgeKill(sessionId: string): Promise<void> {
  if (isPyodideSession(sessionId)) {
    pyodideKill(sessionId);
    return;
  }
  await fetch(`/api/session/${sessionId}/finish`, { method: "DELETE" }).catch(() => {});
}
