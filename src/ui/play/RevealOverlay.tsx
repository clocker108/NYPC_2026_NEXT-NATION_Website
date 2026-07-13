"use client";

// 해소 연출 직전 확인 — 두 플레이어가 함께 결과를 볼 수 있게 모으는 화면 (핫시트 전용).

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { useGameStore } from "@/store/gameStore";

export default function RevealOverlay() {
  const confirmReveal = useGameStore((s) => s.confirmReveal);
  const states = useGameStore((s) => s.states);
  const boxRef = useRef<HTMLDivElement>(null);
  const day = states.length - 1;

  useEffect(() => {
    if (boxRef.current) {
      animate(boxRef.current, { opacity: [0, 1], scale: [0.92, 1], duration: 320, ease: "outQuad" });
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 bg-[#101116]"
      onClick={confirmReveal}
    >
      <div ref={boxRef} className="flex flex-col items-center">
        <span className="text-6xl">👀</span>
        <h2 className="mt-4 text-2xl font-bold">
          두 플레이어 모두 화면을 봐주세요
        </h2>
        <p className="mt-2 text-chromedim">{day}일차 결과가 공개됩니다 — 준비되면 화면을 클릭하세요</p>
      </div>
    </div>
  );
}
