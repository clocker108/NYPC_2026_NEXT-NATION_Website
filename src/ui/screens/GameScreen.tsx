"use client";

// 게임 화면 — 헤더 / (분석 | 맵 | 정보·명령독) / 재생 바 + 인트로·교대·승리 오버레이.

import { useEffect, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { soundManager } from "@/audio/soundManager";
import HeaderBar from "@/ui/HeaderBar";
import MapView from "@/ui/map/MapView";
import PlaybackBar from "@/ui/PlaybackBar";
import CommandDock from "@/ui/play/CommandDock";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ContinuePrompt from "@/ui/play/ContinuePrompt";
import HandoverOverlay from "@/ui/play/HandoverOverlay";
import RevealOverlay from "@/ui/play/RevealOverlay";
import VictoryOverlay from "@/ui/play/VictoryOverlay";
import GameIntro from "@/ui/play/GameIntro";
import RulesOverlay from "@/ui/RulesOverlay";
import AnalysisPanel from "@/ui/panels/AnalysisPanel";
import InfoPanel from "@/ui/panels/InfoPanel";

export default function GameScreen() {
  const backToMenu = useGameStore((s) => s.backToMenu);
  const mode = useGameStore((s) => s.mode);
  // live 객체 전체가 아니라 phase만 구독 — 계획 중 큐 편집마다 GameScreen(→자식 MapView)이 리렌더되지 않게
  const livePhase = useGameStore((s) => s.live?.phase ?? null);
  const anim = useGameStore((s) => s.anim);
  const finalResult = useGameStore((s) => s.finalResult);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const online = useGameStore((s) => s.online);
  // 상대 끊김 → 몰수까지 남은 시간 카운트다운 (0.5초 틱)
  const [, setGraceTick] = useState(0);
  useEffect(() => {
    if (!online?.peerDown || !online.graceUntil) return;
    const iv = setInterval(() => setGraceTick((t) => t + 1), 500);
    return () => clearInterval(iv);
  }, [online?.peerDown, online?.graceUntil]);
  const graceLeft = (() => {
    if (!online?.graceUntil) return "";
    const s = Math.max(0, Math.ceil((online.graceUntil - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  })();
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [exitAsk, setExitAsk] = useState(false); // 게임 이탈 확인 다이얼로그
  const [showRules, setShowRules] = useState(false); // 규칙 오버레이 (게임 상태는 건드리지 않음)
  const isLive = mode === "hotseat" || mode === "bridge" || mode === "online";
  // 온라인 재접속 복구 시엔 VS 인트로 스킵
  const [introDone, setIntroDone] = useState(!isLive || Boolean(online?.resumed));

  // 승패 확정(마지막 연출까지 끝난 뒤) → 게임 BGM 대신 메뉴 BGM으로.
  // 리플레이는 live=null이라 해당 없음. 메뉴 복귀(언마운트) 시 cleanup으로 해제.
  const gameOver = isLive && livePhase === "done" && anim === null;
  useEffect(() => {
    soundManager.setGameOver(gameOver);
    return () => soundManager.setGameOver(false);
  }, [gameOver]);

  const planning = isLive && (livePhase === "planA" || livePhase === "planB");
  // 교대 커튼은 해소 연출이 끝난 뒤에 (연출을 가리지 않도록)
  const handover = (livePhase === "handover" || livePhase === "handoverBack") && !anim;
  const victory =
    isLive && livePhase === "done" && finalResult !== null && anim === null && !victoryDismissed && introDone;

  return (
    <div data-game-root className="screen-enter flex h-screen flex-col bg-mapbg">
      {/* 헤더(≈64px) 안에서 위아래 중앙에 오도록 top-3 + 40px 정사각 아이콘 */}
      <button
        className="absolute left-3 top-3 z-20 grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-chromeline bg-chrome2 text-lg text-chromedim hover:text-white"
        title="메뉴로 돌아가기"
        onClick={() => {
          if (isLive && livePhase !== null && livePhase !== "done") setExitAsk(true);
          else backToMenu();
        }}
      >
        ←
      </button>
      {/* 우상단 규칙 아이콘 — 좌상단 ← 버튼과 동일 스타일 */}
      <button
        className="absolute right-3 top-3 z-20 grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-chromeline bg-chrome2 text-lg text-chromedim hover:text-white"
        title="게임 규칙"
        aria-label="게임 규칙"
        onClick={() => setShowRules(true)}
      >
        📖
      </button>
      <HeaderBar />
      <div className="relative flex min-h-0 flex-1">
        {showAnalysis && <AnalysisPanel />}
        <button
          className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-lg border border-l-0 border-chromeline bg-chrome2 px-1 py-3 text-xs text-chromedim hover:text-white"
          style={{ left: showAnalysis ? 288 : 0 }}
          onClick={() => setShowAnalysis(!showAnalysis)}
          title="분석 패널"
        >
          {showAnalysis ? "◀" : "▶"}
        </button>

        <MapView />

        {/* 관전 단계 안내 — 헤더 바로 아래, 맵 클릭이 진행을 담당 */}
        {introDone && livePhase === "review" && !anim && <ContinuePrompt />}

        {/* 온라인 연결 상태 배너 — 헤더 바로 아래 */}
        {mode === "online" && online && (online.fatal || online.peerDown || online.selfDown) && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
            <span
              className={`rounded-full border px-4 py-2.5 text-[13px] font-bold shadow-lg ${
                online.fatal
                  ? "border-nred/70 bg-[#3b1815]/80 text-[#ff8a7a]"
                  : "border-ngold/60 bg-[#3a2d10]/80 text-ngold"
              }`}
            >
              {online.fatal
                ? `⚠ 연결 종료: ${online.fatal}`
                : online.selfDown
                  ? "🔌 연결이 끊겨 재접속하는 중…"
                  : `🔌 상대 연결 끊김 — 몰수승까지 ${graceLeft}`}
            </span>
          </div>
        )}

        {planning ? (
          <CommandDock />
        ) : (
          <>
            {showInfo && <InfoPanel />}
            <button
              className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-lg border border-r-0 border-chromeline bg-chrome2 px-1 py-3 text-xs text-chromedim hover:text-white"
              style={{ right: showInfo ? 288 : 0 }}
              onClick={() => setShowInfo(!showInfo)}
              title="정보 패널"
            >
              {showInfo ? "▶" : "◀"}
            </button>
          </>
        )}
      </div>
      <PlaybackBar />
      {!introDone && <GameIntro onDone={() => setIntroDone(true)} />}
      {introDone && livePhase === "reveal" && <RevealOverlay />}
      {introDone && handover && <HandoverOverlay />}
      {victory && <VictoryOverlay onClose={() => setVictoryDismissed(true)} />}
      {exitAsk && (
        <ConfirmDialog
          icon="🚪"
          message={
            mode === "online"
              ? "지금 나가면 몰수패로 처리됩니다. 정말 나갈까요?"
              : "게임을 종료하고 메뉴로 돌아갈까요? 진행 중인 대전은 사라집니다."
          }
          confirmLabel="나가기"
          cancelLabel="계속하기"
          onConfirm={backToMenu}
          onCancel={() => setExitAsk(false)}
        />
      )}
      {showRules && <RulesOverlay onClose={() => setShowRules(false)} />}
    </div>
  );
}
