"use client";

// 승리 화면 — 게임 종료 시 임팩트 있게 승자를 발표. (라이브 모드 전용)

import { useEffect, useRef } from "react";
import { soundManager } from "@/audio/soundManager";
import { createTimeline } from "animejs";
import { useGameStore } from "@/store/gameStore";

interface Props {
  onClose: () => void;
}

export default function VictoryOverlay({ onClose }: Props) {
  const finalResult = useGameStore((s) => s.finalResult);
  const names = useGameStore((s) => s.names);
  const viewDay = useGameStore((s) => s.viewDay);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const rootRef = useRef<HTMLDivElement>(null);

  const parts = (finalResult ?? "").split(/\s+/); // RESULT <winner> <reason>
  const winner = parts[1];
  const reason = parts[2];
  const isDraw = winner === "DRAW";
  const winSide = winner === "LEFT_WIN" ? 0 : 1;
  const winName = isDraw ? "" : winSide === 0 ? names[0] : names[1];
  const reasonKo =
    reason === "HQ_DESTROYED" ? "본부 파괴" : reason === "TURN_LIMIT" ? "턴 제한 판정" : "규칙 위반(WA)";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = (sel: string) => root.querySelector(sel);
    soundManager.play("game-end");
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    tl.add(root, { opacity: [0, 1], duration: 260, ease: "outQuad" }, 0);
    const trophy = q("[data-v='trophy']");
    if (trophy) tl.add(trophy, { scale: [0, 1.35, 1], rotate: ["-18deg", "0deg"], duration: 700 }, 120);
    const title = q("[data-v='title']");
    if (title) tl.add(title, { scale: [2.6, 1], opacity: [0, 1], duration: 480 }, 260);
    const sub = q("[data-v='sub']");
    if (sub) tl.add(sub, { translateY: [24, 0], opacity: [0, 1], duration: 380 }, 620);
    const btns = q("[data-v='btns']");
    if (btns) tl.add(btns, { translateY: [20, 0], opacity: [0, 1], duration: 320 }, 820);
    return () => {
      tl.cancel();
    };
  }, []);

  const accent = isDraw ? "text-zinc-200" : winSide === 0 ? "text-nred" : "text-nblue";
  const glow = isDraw
    ? "from-zinc-500/25"
    : winSide === 0
      ? "from-[#e04b3f66]"
      : "from-[#3f7fd666]";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0e0f13]/92 opacity-0"
    >
      {/* 승자 색 글로우 */}
      <div className={`pointer-events-none absolute inset-0 bg-radial ${glow} to-transparent`} />

      <div data-v="trophy" className="text-8xl" style={{ opacity: 1 }}>
        {isDraw ? "🤝" : "🏆"}
      </div>

      <h1 data-v="title" className="mt-5 text-center text-6xl font-black tracking-tight opacity-0">
        {isDraw ? (
          "무승부"
        ) : (
          <>
            <span className={accent}>{winName}</span> 승리!
          </>
        )}
      </h1>

      <p data-v="sub" className="mt-4 text-lg text-chromedim opacity-0">
        {reasonKo} · {viewDay}턴
      </p>

      <div data-v="btns" className="mt-5 flex gap-4 opacity-0">
        <button
          className="rounded-xl border border-chromeline bg-chrome2 px-6 py-3 font-bold hover:border-zinc-500"
          onClick={onClose}
        >
          결과 살펴보기
        </button>
        <button
          className={`rounded-xl px-6 py-3 font-bold ${isDraw ? "bg-zinc-600" : winSide === 0 ? "bg-nred hover:bg-nreddark" : "bg-nblue hover:bg-nbluedark"}`}
          onClick={backToMenu}
        >
          메뉴로
        </button>
      </div>
    </div>
  );
}
