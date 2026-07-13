"use client";

// 전역 게임 스토어 (zustand) — 히스토리가 스크러버·차트·헤더를 전부 구동하고,
// 라이브 플레이(핫시트/AI)는 live 슬라이스가 담당한다.

import { create } from "zustand";
import type { MapData } from "@/engine/map";
import type { Command, GameState, Side } from "@/engine/types";
import { commandsToLines } from "@/engine/types";
import type { TurnEvents } from "@/engine/events";
import type { DayStats } from "@/engine/stats";
import type { Polygon } from "@/engine/voronoi";
import { computeCellPolygons } from "@/engine/voronoi";
import { computeStats } from "@/engine/stats";
import { parseLog } from "@/engine/logParser";
import { replayLog } from "@/engine/replay";
import { isCombatTurn } from "@/engine/events";
import { initState } from "@/engine/state";
import { generateMap } from "@/engine/mapgen";
import { applyTurn } from "@/engine/turn";
import { checkPlan } from "@/engine/plan";
import { botResultBlock } from "@/engine/serialize";
import { bridgeFinish, bridgeKill, bridgeTurn, createBridgeSession } from "@/bridge/client";
import {
  OnlineClient,
  clearSession,
  loadSession,
  type OnlineHandlers,
  type ResumeInfo,
  type StartInfo,
} from "@/online/roomClient";
import type { TurnLimit } from "@/online/protocol";

export type Screen = "menu" | "game";
export type Mode = "replay" | "hotseat" | "bridge" | "online";
export type Speed = 0.5 | 1 | 2 | 4 | 8 | 16;

export type LivePhase = "planA" | "handover" | "planB" | "reveal" | "review" | "handoverBack" | "done";
// (핫시트 전용) handover = A제출 후 B에게 / reveal = 해소 연출 전 "모두 보세요" /
// review = 연출 후 자유 관전(클릭해야 진행) / handoverBack = 그 다음 다시 A에게

export interface ViewOptions {
  showPaths: boolean;
  showCellNumbers: boolean;
  showEdges: boolean;
}

export interface LiveState {
  phase: LivePhase;
  queued: Command[];
  sealedA: Command[]; // A 제출분 (B 계획 중 비공개)
  selCell: number | null; // 병력 출발지 선택
  selCount: number; // 보낼 전사 수
  destMode: boolean; // 목적지 클릭 대기
  planError: string | null;
  waiting: boolean; // 브리지 봇 응답 대기 중
}

export function planningSide(phase: LivePhase): Side | null {
  if (phase === "planA") return 0;
  if (phase === "planB") return 1;
  return null;
}

interface GameStore {
  screen: Screen;
  mode: Mode | null;

  map: MapData | null;
  polygons: Polygon[];
  names: [string, string];

  states: GameState[];
  events: TurnEvents[];
  stats: DayStats[];
  combatTicks: number[];
  finalResult: string | null;

  viewDay: number;
  playing: boolean;
  speed: Speed;
  /** 진행 중인 턴 연출 (viewDay = anim.day 로 이미 확정, 화면은 직전 상태 + 연출) */
  anim: { day: number } | null;

  selectedCell: number | null;
  hoverCell: number | null;
  options: ViewOptions;

  live: LiveState | null;

  // 브리지(진짜 Python 봇)
  humanSide: Side;
  sessionId: string | null;

  // 인터넷 대전 (WebSocket PvP)
  online: OnlineState | null;

  // 로컬/인공지능 대전용 턴 제한 (0 = 없음). 온라인은 서버 권위(online.deadline)라 별개.
  turnLimit: TurnLimit;
  turnDeadline: number | null; // 현재 계획 페이즈의 마감 (로컬 시계)

  // 공통
  loadReplay: (text: string) => { ok: boolean; error?: string };
  backToMenu: () => void;
  setViewDay: (d: number) => void;
  stepDay: (delta: number) => void;
  /** 한 턴 전진 + 연출 재생 (재생 루프·수동 스텝용) */
  advanceWithAnim: () => void;
  animDone: () => void;
  setPlaying: (b: boolean) => void;
  setSpeed: (s: Speed) => void;
  setHoverCell: (c: number | null) => void;
  toggleOption: (k: keyof ViewOptions) => void;

  // 라이브 플레이
  startHotseat: (opts: { np?: number; npRange?: [number, number]; seed?: number; nameA?: string; nameB?: string; turnLimit?: TurnLimit }) => void;
  startBridge: (opts: {
    np?: number;
    npRange?: [number, number];
    seed?: number;
    turnLimit?: TurnLimit;
    humanSide: Side;
    botId: string;
    botName: string;
    /** 세션 준비 중 사용자가 화면을 벗어났으면 true — 게임 진입 대신 조용히 정리 */
    isCancelled?: () => boolean;
  }) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
  startOnlineHost: (opts: StartOnlineHostOpts) => Promise<{ ok: boolean; code?: string; error?: string; cancelled?: boolean }>;
  startOnlineJoin: (opts: StartOnlineJoinOpts) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
  /** 새로고침 후 세션 복구 — 저장된 방 세션이 있으면 시도 */
  rejoinOnline: () => Promise<{ ok: boolean; error?: string }>;
  /** 대기실(초대 후 상대 기다림) 취소 — 방 폐기 */
  cancelOnlineWait: () => void;
  hasOnlineSession: () => boolean;
  clickCell: (i: number) => void;
  setSelCount: (n: number) => void;
  beginDestMode: () => void;
  queueTrain: (n: number) => void;
  queueUpgrade: (region: number) => void;
  removeQueued: (idx: number) => void;
  clearQueue: () => void;
  submitPlan: () => void;
  confirmHandover: () => void;
  confirmReveal: () => void;
  confirmReview: () => void;
}

export interface StartOnlineHostOpts {
  nick: string;
  np?: number;
  npRange?: [number, number];
  seed?: number;
  turnLimit: TurnLimit;
  isCancelled?: () => boolean;
}

export interface StartOnlineJoinOpts {
  nick: string;
  code: string;
  isCancelled?: () => boolean;
}

export interface OnlineState {
  code: string;
  seat: Side;
  turnLimit: TurnLimit;
  deadline: number | null; // 로컬 시계 기준 턴 마감
  oppSubmitted: boolean;
  peerDown: boolean;
  graceUntil: number | null; // 상대 재접속 유예 마감 (로컬 시계)
  selfDown: boolean; // 내 연결이 끊겨 재접속 중
  resumed: boolean; // 새로고침 복구로 진입 (인트로 스킵)
  fatal: string | null; // 복구 불가 오류 문구
}

const emptyHistory = {
  map: null as MapData | null,
  polygons: [] as Polygon[],
  states: [] as GameState[],
  events: [] as TurnEvents[],
  stats: [] as DayStats[],
  combatTicks: [] as number[],
  finalResult: null as string | null,
  viewDay: 0,
  playing: false,
  selectedCell: null as number | null,
  hoverCell: null as number | null,
  anim: null as { day: number } | null,
  live: null as LiveState | null,
  humanSide: 0 as Side,
  sessionId: null as string | null,
  online: null as OnlineState | null,
  turnLimit: 0 as TurnLimit,
  turnDeadline: null as number | null,
};

function freshLive(phase: LivePhase = "planA"): LiveState {
  return {
    phase,
    queued: [],
    sealedA: [],
    selCell: null,
    selCount: 0,
    destMode: false,
    planError: null,
    waiting: false,
  };
}

// 인터넷 대전 클라이언트 싱글턴 — 스토어에는 평문 상태만 두고 소켓 객체는 모듈 스코프에.
// 세대(gen) 토큰으로 스테일 핸들러(이전 게임의 늦은 메시지)를 차단한다.
let onlineClient: OnlineClient | null = null;
let onlineGen = 0;

export const useGameStore = create<GameStore>((set, get) => {
  /** 로컬/AI 대전의 계획 페이즈 타이머 무장 (턴 제한 없으면 해제) */
  const armLocalTimer = () => {
    const { turnLimit } = get();
    set({ turnDeadline: turnLimit > 0 ? Date.now() + turnLimit * 1000 : null });
  };

  /** 확정된 턴을 히스토리에 반영 — 핫시트/브리지 submitPlan과 온라인 onTurn이 공유 */
  const resolveTurn = (linesA: string[], linesB: string[], nextPhase: LivePhase, animNow = true) => {
    const { map, states, events } = get();
    if (!map) return;
    const cur = states[states.length - 1];
    const { state: next, events: ev } = applyTurn(map, cur, [linesA, linesB]);
    const newStates = [...states, next];
    const newEvents = [...events, ev];
    const finished = next.result !== null;
    set({
      states: newStates,
      events: newEvents,
      stats: computeStats(newStates, newEvents),
      combatTicks: newEvents.filter(isCombatTurn).map((e) => e.day),
      viewDay: newStates.length - 1,
      // animNow=false(핫시트)면 reveal 확인 후 confirmReveal에서 연출 시작
      anim: animNow ? { day: newStates.length - 1 } : null,
      finalResult: next.result ? `RESULT ${next.result.winner} ${next.result.reason}` : null,
      live: freshLive(animNow && finished ? "done" : nextPhase),
      selectedCell: null,
    });
    // 다음 페이즈가 계획이면(브리지 planA/planB 루프) 로컬 타이머 재무장
    const mode = get().mode;
    if (!finished && (mode === "hotseat" || mode === "bridge") && (nextPhase === "planA" || nextPhase === "planB")) {
      armLocalTimer();
    } else if (mode !== "online") {
      set({ turnDeadline: null });
    }
  };

  /* ── 인터넷 대전 핸들러 (세대 가드 포함) ── */

  const enterOnlineGame = (info: StartInfo, opts?: { resumed?: boolean }) => {
    const map = info.map as MapData;
    const st0 = initState(map);
    set({
      ...emptyHistory,
      screen: "game",
      mode: "online",
      map,
      polygons: computeCellPolygons(map),
      names: info.nicks,
      states: [st0],
      stats: computeStats([st0], []),
      live: freshLive(info.seat === 0 ? "planA" : "planB"),
      humanSide: info.seat,
      online: {
        code: onlineClientCode(),
        seat: info.seat,
        turnLimit: info.turnLimit,
        deadline: info.deadline,
        oppSubmitted: false,
        peerDown: false,
        graceUntil: null,
        selfDown: false,
        resumed: opts?.resumed ?? false,
        fatal: null,
      },
    });
  };

  const onlineClientCode = () => get().online?.code ?? loadSession()?.code ?? "";

  const applyServerTurn = (day: number, a: string[], b: string[], deadline: number | null) => {
    const st = get();
    if (st.mode !== "online" || !st.online) return;
    if (day !== st.states.length) return; // 이미 반영됐거나 순서 불일치 (resume 재생과의 중복 방지)
    const seat = st.online.seat;
    resolveTurn(a, b, seat === 0 ? "planA" : "planB");
    const after = get();
    set({
      online: after.online ? { ...after.online, deadline, oppSubmitted: false } : after.online,
    });
    // 게임이 이 턴으로 끝났으면 서버에 결과 통보 (알람 정지·방 정리)
    if (after.finalResult) onlineClient?.sendFinish(day, after.finalResult);
  };

  const makeOnlineHandlers = (gen: number): OnlineHandlers => {
    const live = () => onlineGen === gen; // 이 게임 세대가 여전히 활성인가
    const inGame = () => live() && get().mode === "online" && get().online !== null;
    return {
      onStart: (info) => {
        if (!live()) return;
        enterOnlineGame(info);
      },
      onTurn: (day, a, b, deadline) => {
        if (!inGame()) return;
        applyServerTurn(day, a, b, deadline);
      },
      onPeerSubmitted: () => {
        if (!inGame()) return;
        set((s) => ({ online: s.online ? { ...s.online, oppSubmitted: true } : s.online }));
      },
      onPeerDown: (graceUntil) => {
        if (!inGame()) return;
        set((s) => ({ online: s.online ? { ...s.online, peerDown: true, graceUntil } : s.online }));
      },
      onPeerUp: () => {
        if (!inGame()) return;
        set((s) => ({ online: s.online ? { ...s.online, peerDown: false, graceUntil: null } : s.online }));
      },
      onSelfDown: () => {
        if (!inGame()) return;
        set((s) => ({ online: s.online ? { ...s.online, selfDown: true } : s.online }));
      },
      onSelfUp: (info: ResumeInfo) => {
        if (!inGame()) return;
        for (const m of info.missed) applyServerTurn(m.day, m.a, m.b, null);
        set((s) => ({
          online: s.online
            ? {
                ...s.online,
                selfDown: false,
                deadline: info.deadline,
                oppSubmitted: info.peerSubmitted,
                peerDown: !info.peerConnected,
                graceUntil: null,
              }
            : s.online,
          live:
            s.live && s.live.phase !== "done"
              ? { ...s.live, waiting: info.youSubmitted }
              : s.live,
        }));
      },
      onFinish: (result) => {
        if (!inGame()) return;
        if (get().finalResult) return; // 로컬 엔진이 이미 판정함
        set({ finalResult: result, live: freshLive("done"), online: { ...get().online!, deadline: null } });
      },
      onFatal: (code, msg) => {
        if (!inGame()) return;
        set((s) => ({
          online: s.online ? { ...s.online, fatal: msg ?? code, deadline: null } : s.online,
          live: s.live ? freshLive("done") : s.live,
        }));
      },
    };
  };

  return {
  screen: "menu",
  mode: null,
  names: ["LEFT", "RIGHT"],
  speed: 1,
  options: { showPaths: true, showCellNumbers: false, showEdges: false },
  ...emptyHistory,

  loadReplay: (text: string) => {
    try {
      const parsed = parseLog(text);
      const replay = replayLog(parsed);
      set({
        ...emptyHistory,
        screen: "game",
        mode: "replay",
        map: parsed.map,
        polygons: computeCellPolygons(parsed.map),
        names: [parsed.names[0] || "LEFT", parsed.names[1] || "RIGHT"],
        states: replay.states,
        events: replay.events,
        stats: computeStats(replay.states, replay.events),
        combatTicks: replay.events.filter(isCombatTurn).map((ev) => ev.day),
        finalResult: replay.finalResult ?? parsed.finalResult,
        playing: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  backToMenu: () => {
    const sid = get().sessionId;
    if (sid) void bridgeKill(sid); // 서버/Pyodide 어느 백엔드든 정리
    if (get().mode === "online") {
      // 게임 중 이탈 = 몰수패 (leave가 세션 삭제까지 처리)
      onlineGen++;
      onlineClient?.leave();
      onlineClient = null;
    }
    set({ ...emptyHistory, screen: "menu", mode: null });
  },

  setViewDay: (d: number) => {
    const max = get().states.length - 1;
    set({ viewDay: Math.max(0, Math.min(max, d)), anim: null });
  },

  stepDay: (delta: number) => {
    const { viewDay, states } = get();
    const max = states.length - 1;
    if (delta === 1 && viewDay < max) {
      // 앞으로 한 턴 = 그 턴의 연출 재생
      set({ viewDay: viewDay + 1, anim: { day: viewDay + 1 }, playing: false });
      return;
    }
    set({ viewDay: Math.max(0, Math.min(max, viewDay + delta)), playing: false, anim: null });
  },

  advanceWithAnim: () => {
    const { viewDay, states, anim } = get();
    if (anim) return; // 연출 중엔 대기
    const max = states.length - 1;
    if (viewDay >= max) {
      set({ playing: false });
      return;
    }
    set({ viewDay: viewDay + 1, anim: { day: viewDay + 1 } });
  },

  animDone: () => set({ anim: null }),

  setPlaying: (b: boolean) => {
    const { viewDay, states } = get();
    if (b && viewDay >= states.length - 1) set({ viewDay: 0, playing: true });
    else set({ playing: b });
  },

  setSpeed: (s: Speed) => set({ speed: s }),
  setHoverCell: (c) => set({ hoverCell: c }),
  toggleOption: (k) => set((st) => ({ options: { ...st.options, [k]: !st.options[k] } })),

  // ── 라이브 플레이 ────────────────────────────────────────────────
  startHotseat: (opts) => {
    const map = generateMap({ np: opts.np, npRange: opts.npRange, seed: opts.seed });
    const st0 = initState(map);
    set({
      ...emptyHistory,
      screen: "game",
      mode: "hotseat",
      map,
      polygons: computeCellPolygons(map),
      names: [opts.nameA?.trim() || "플레이어 A", opts.nameB?.trim() || "플레이어 B"],
      states: [st0],
      stats: computeStats([st0], []),
      live: freshLive(),
      turnLimit: opts.turnLimit ?? 0,
    });
    armLocalTimer(); // A의 첫 계획 페이즈
  },

  startBridge: async (opts) => {
    try {
      const map = generateMap({ np: opts.np, npRange: opts.npRange, seed: opts.seed });
      const botSide = opts.humanSide === 0 ? "RIGHT" : "LEFT";
      const sessionId = await createBridgeSession(opts.botId, botSide, map);
      if (opts.isCancelled?.()) {
        // 대기 중 사용자가 떠남 — 방금 스폰된 봇 세션을 정리하고 게임 진입은 하지 않는다
        void bridgeFinish(sessionId, []);
        return { ok: false, cancelled: true };
      }
      const st0 = initState(map);
      set({
        ...emptyHistory,
        screen: "game",
        mode: "bridge",
        map,
        polygons: computeCellPolygons(map),
        names: opts.humanSide === 0 ? ["플레이어", opts.botName] : [opts.botName, "플레이어"],
        states: [st0],
        stats: computeStats([st0], []),
        live: freshLive(opts.humanSide === 0 ? "planA" : "planB"),
        humanSide: opts.humanSide,
        sessionId,
        turnLimit: opts.turnLimit ?? 0,
      });
      armLocalTimer(); // 첫 계획 페이즈
      return { ok: true };
    } catch (e) {
      if (opts.isCancelled?.()) return { ok: false, cancelled: true };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  // ── 인터넷 대전 ──────────────────────────────────────────────────
  startOnlineHost: async (opts) => {
    const gen = ++onlineGen;
    onlineClient?.destroy();
    const map = generateMap({ np: opts.np, npRange: opts.npRange, seed: opts.seed });
    const client = new OnlineClient(makeOnlineHandlers(gen), () => Math.max(0, get().states.length - 1));
    onlineClient = client;
    try {
      const { code } = await client.host(opts.nick, map, opts.turnLimit);
      if (opts.isCancelled?.() || onlineGen !== gen) {
        client.leave(); // 로비 leave = 방 폐기
        return { ok: false, cancelled: true };
      }
      return { ok: true, code };
    } catch (e) {
      client.destroy();
      if (onlineClient === client) onlineClient = null;
      if (opts.isCancelled?.()) return { ok: false, cancelled: true };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  startOnlineJoin: async (opts) => {
    const gen = ++onlineGen;
    onlineClient?.destroy();
    const client = new OnlineClient(makeOnlineHandlers(gen), () => Math.max(0, get().states.length - 1));
    onlineClient = client;
    try {
      const info = await client.join(opts.nick, opts.code);
      if (opts.isCancelled?.() || onlineGen !== gen) {
        client.leave();
        return { ok: false, cancelled: true };
      }
      enterOnlineGame(info);
      return { ok: true };
    } catch (e) {
      client.destroy();
      if (onlineClient === client) onlineClient = null;
      if (opts.isCancelled?.()) return { ok: false, cancelled: true };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  rejoinOnline: async () => {
    const session = loadSession();
    if (!session) return { ok: false, error: "저장된 대전이 없습니다" };
    const gen = ++onlineGen;
    onlineClient?.destroy();
    const client = new OnlineClient(makeOnlineHandlers(gen), () => Math.max(0, get().states.length - 1));
    onlineClient = client;
    try {
      const info = await client.rejoin(session);
      if (onlineGen !== gen) return { ok: false };
      if (info.phase === "lobby") {
        // 아직 상대가 안 들어옴 — 대기 상태로 (호스트만 가능)
        return { ok: true };
      }
      // 히스토리 전체 재생으로 상태 복원
      enterOnlineGame(info, { resumed: true });
      for (const m of info.missed) applyServerTurn(m.day, m.a, m.b, null);
      set((s) => ({
        anim: null, // 재생 연출 없이 최신 상태로
        viewDay: s.states.length - 1,
        online: s.online
          ? {
              ...s.online,
              deadline: info.deadline,
              oppSubmitted: info.peerSubmitted,
              peerDown: !info.peerConnected,
            }
          : s.online,
        live:
          s.live && s.live.phase !== "done" && info.youSubmitted
            ? { ...s.live, waiting: true }
            : s.live,
      }));
      return { ok: true };
    } catch (e) {
      client.destroy();
      if (onlineClient === client) onlineClient = null;
      clearSession(); // 만료된 세션은 정리해 재접속 배너를 지운다
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  cancelOnlineWait: () => {
    onlineGen++;
    onlineClient?.leave();
    onlineClient = null;
  },

  hasOnlineSession: () => loadSession() !== null,

  clickCell: (i: number) => {
    const { live, mode, map, states, viewDay, anim } = get();
    // 관전(review) 중엔 맵 클릭 = 다음으로 진행 (연출이 끝난 뒤에만)
    if (live?.phase === "review" && !anim) {
      get().confirmReview();
      return;
    }
    const side = live ? planningSide(live.phase) : null;
    const isPlanning =
      (mode === "hotseat" || mode === "bridge" || mode === "online") &&
      live !== null &&
      !live.waiting && // 봇 응답 대기 중엔 제출된 계획을 더 못 바꾼다
      side !== null &&
      viewDay === states.length - 1;

    if (!isPlanning || !map) {
      set({ selectedCell: get().selectedCell === i ? null : i });
      return;
    }

    const cur = states[states.length - 1];

    if (live!.destMode && live!.selCell !== null) {
      // 목적지 클릭 → 선택 병력 MOVE 큐잉
      const src = live!.selCell;
      if (i === src) {
        set({ live: { ...live!, destMode: false, planError: null } });
        return;
      }
      const queuedMoves = new Set(
        live!.queued.filter((c) => c.type === "MOVE").map((c) => (c as { suffix: number }).suffix),
      );
      const idle: number[] = [];
      for (const w of cur.warriors.values()) {
        if (w.side === side && w.region === src && w.hp > 0 && w.movingTarget === null && !queuedMoves.has(w.suffix))
          idle.push(w.suffix);
      }
      idle.sort((a, b) => a - b);
      const chosen = idle.slice(0, live!.selCount);
      if (chosen.length === 0) {
        set({ live: { ...live!, destMode: false, planError: "보낼 수 있는 전사가 없습니다" } });
        return;
      }
      const batch: Command[] = chosen.map((sfx) => ({ type: "MOVE", suffix: sfx, region: i }));
      const check = checkPlan(map, cur, side!, [...live!.queued, ...batch]);
      if (!check.ok) {
        set({ live: { ...live!, destMode: false, planError: check.error } });
        return;
      }
      set({
        live: {
          ...live!,
          queued: [...live!.queued, ...batch],
          destMode: false,
          selCell: null,
          selCount: 0,
          planError: null,
        },
        selectedCell: null,
      });
      return;
    }

    // 일반 클릭: 셀 선택 (+ 자기 병력 있으면 출발지 후보)
    let idleCount = 0;
    for (const w of cur.warriors.values()) {
      if (w.side === side && w.region === i && w.hp > 0 && w.movingTarget === null) idleCount += 1;
    }
    const queuedMoves = new Set(
      live!.queued.filter((c) => c.type === "MOVE").map((c) => (c as { suffix: number }).suffix),
    );
    for (const w of cur.warriors.values()) {
      if (w.side === side && w.region === i && queuedMoves.has(w.suffix)) idleCount -= 1;
    }
    set({
      selectedCell: i,
      live: {
        ...live!,
        selCell: idleCount > 0 ? i : null,
        selCount: idleCount > 0 ? 1 : 0, // 기본 1명 — 전체는 UI '최대' 버튼으로
        destMode: false,
        planError: null,
      },
    });
  },

  setSelCount: (n: number) => {
    const { live } = get();
    if (!live || live.waiting) return;
    set({ live: { ...live, selCount: Math.max(1, n) } });
  },

  beginDestMode: () => {
    const { live } = get();
    if (!live || live.waiting || live.selCell === null) return;
    set({ live: { ...live, destMode: true, planError: null } });
  },

  queueTrain: (n: number) => {
    const { live, map, states } = get();
    const side = live ? planningSide(live.phase) : null;
    if (!live || live.waiting || side === null || !map) return;
    const without = live.queued.filter((c) => c.type !== "TRAIN");
    const next: Command[] = n > 0 ? [...without, { type: "TRAIN", n }] : without;
    const check = checkPlan(map, states[states.length - 1], side, next);
    if (!check.ok) {
      set({ live: { ...live, planError: check.error } });
      return;
    }
    set({ live: { ...live, queued: next, planError: null } });
  },

  queueUpgrade: (region: number) => {
    const { live, map, states } = get();
    const side = live ? planningSide(live.phase) : null;
    if (!live || live.waiting || side === null || !map) return;
    if (live.queued.some((c) => c.type === "UPGRADE" && c.region === region)) return;
    const next: Command[] = [...live.queued, { type: "UPGRADE", region }];
    const check = checkPlan(map, states[states.length - 1], side, next);
    if (!check.ok) {
      set({ live: { ...live, planError: check.error } });
      return;
    }
    set({ live: { ...live, queued: next, planError: null } });
  },

  removeQueued: (idx: number) => {
    const { live } = get();
    if (!live || live.waiting) return;
    set({ live: { ...live, queued: live.queued.filter((_, i) => i !== idx), planError: null } });
  },

  clearQueue: () => {
    const { live } = get();
    if (!live || live.waiting) return;
    set({ live: { ...live, queued: [], planError: null } });
  },

  submitPlan: () => {
    const { live, mode } = get();
    if (!live) return;
    const resolve = resolveTurn;

    if (mode === "online") {
      // 인터넷 대전: 내 명령만 서버로 — 해소는 onTurn 핸들러가 수행
      // (타이머 자동 턴은 내 제출 없이도 도착하므로 여기서 await하지 않는다)
      const { online } = get();
      if (!online || live.waiting || online.fatal) return;
      const queuedAtSubmit = live.queued;
      set({ live: { ...live, waiting: true, planError: null } });
      onlineClient?.submit(get().states.length, commandsToLines(online.seat, queuedAtSubmit));
      return;
    }

    if (mode === "bridge") {
      // 진짜 봇: 봇 백엔드(기본 Pyodide, 폴백 서버)로 직전 결과블록 전달 → 봇 명령 수신 → 해소
      const { sessionId, humanSide } = get();
      if (!sessionId || live.waiting) return;
      const mySession = sessionId;
      const queuedAtSubmit = live.queued; // 제출 시점 스냅샷 — 이후 편집은 이번 턴에 반영 안 됨
      set({ live: { ...live, waiting: true, planError: null }, turnDeadline: null });
      void (async () => {
        const st0 = get();
        const day = st0.states.length; // 이번에 해소할 날
        const prevEv = st0.events[st0.events.length - 1];
        const rb = prevEv ? botResultBlock(prevEv, 0, 5, 0, 5) : [];
        // 응답 도착 시점에 다른 게임(메뉴 복귀·새 세션)이면 스테일 응답 — 무시
        const stale = () => {
          const now = get();
          return now.mode !== "bridge" || now.sessionId !== mySession || !now.live;
        };
        try {
          const res = await bridgeTurn(mySession, day, rb);
          if (stale()) return;
          if ("timeout" in res) {
            // 봇 시간초과 = 봇 WA패
            const winner = humanSide === 0 ? "LEFT_WIN" : "RIGHT_WIN";
            set({
              finalResult: `RESULT ${winner} WA`,
              live: freshLive("done"),
            });
            void bridgeFinish(mySession, []);
            return;
          }
          const humanLines = commandsToLines(humanSide, queuedAtSubmit);
          const botLines = res.commands;
          const linesA = humanSide === 0 ? humanLines : botLines;
          const linesB = humanSide === 0 ? botLines : humanLines;
          resolve(linesA, linesB, humanSide === 0 ? "planA" : "planB");
          // 종료 시 봇에 최종 결과 전달
          const after = get();
          if (after.live?.phase === "done") {
            const lastEv = after.events[after.events.length - 1];
            void bridgeFinish(mySession, lastEv ? botResultBlock(lastEv, 0, 5, 0, 5) : []);
          }
        } catch (e) {
          if (stale()) return;
          const liveNow = get().live;
          if (liveNow)
            set({
              live: { ...liveNow, waiting: false, planError: e instanceof Error ? e.message : String(e) },
            });
        }
      })();
      return;
    }

    if (live.phase === "planA") {
      set({
        turnDeadline: null, // 커튼 동안은 타이머 없음
        live: {
          ...live,
          phase: "handover",
          sealedA: live.queued,
          queued: [],
          selCell: null,
          selCount: 0,
          destMode: false,
          planError: null,
        },
        selectedCell: null,
      });
    } else if (live.phase === "planB") {
      // 해소는 즉시 계산하되, 연출은 "모두 보세요"(reveal) 확인 후 시작
      resolve(commandsToLines(0, live.sealedA), commandsToLines(1, live.queued), "reveal", false);
    }
  },

  confirmHandover: () => {
    const { live } = get();
    if (!live) return;
    if (live.phase === "handover") {
      set({ live: { ...live, phase: "planB" } });
      armLocalTimer(); // B의 계획 시작
    } else if (live.phase === "handoverBack") {
      set({ live: { ...live, phase: "planA" } });
      armLocalTimer(); // 다음 날 A의 계획 시작
    }
  },

  confirmReveal: () => {
    const { live, states } = get();
    if (!live || live.phase !== "reveal") return;
    const finished = states[states.length - 1]?.result !== null;
    set({
      anim: { day: states.length - 1 }, // 이제 모두가 보는 앞에서 해소 연출 시작
      viewDay: states.length - 1, // 커튼 중 단축키 등으로 어긋났어도 다시 고정
      playing: false,
      // 연출 후엔 자유 관전(review) — "계속" 클릭 후에야 A에게 넘기는 커튼
      live: { ...live, phase: finished ? "done" : "review" },
    });
  },

  confirmReview: () => {
    const { live, states } = get();
    if (!live || live.phase !== "review") return;
    // 관전 중 과거로 스크럽했더라도 계획은 항상 최신 상태에서
    set({
      live: { ...live, phase: "handoverBack" },
      viewDay: states.length - 1,
      anim: null,
      playing: false,
      selectedCell: null,
    });
  },
  };
});
