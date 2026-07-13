"use client";

// 핫시트 교대 커튼 — 계획 유출 방지(A→B) + 해소 후 차례 안내(→A). 전체 화면을 덮는다.

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { useGameStore } from "@/store/gameStore";

export default function HandoverOverlay() {
  const confirmHandover = useGameStore((s) => s.confirmHandover);
  const phase = useGameStore((s) => s.live?.phase);
  const names = useGameStore((s) => s.names);
  const boxRef = useRef<HTMLDivElement>(null);

  const toB = phase === "handover";
  const name = toB ? names[1] : names[0];
  const colorCls = toB ? "text-nblue" : "text-nred";

  useEffect(() => {
    if (boxRef.current) {
      animate(boxRef.current, { opacity: [0, 1], scale: [0.92, 1], duration: 320, ease: "outQuad" });
    }
  }, [phase]);

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 bg-[#101116]"
      onClick={confirmHandover}
    >
      <div ref={boxRef} className="flex flex-col items-center">
        <span className="text-6xl">🔄</span>
        <h2 className="mt-4 text-2xl font-bold">
          <span className={colorCls}>{name}</span>에게 넘겨주세요
        </h2>
        <p className="mt-2 text-chromedim">준비되면 화면을 클릭해 {toB ? "계획을 시작합니다" : "다음 턴을 시작합니다"}</p>
      </div>
    </div>
  );
}
