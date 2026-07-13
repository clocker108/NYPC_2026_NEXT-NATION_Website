"use client";

// 상단 헤더 — 빨강 A | 스탯 | TURN | 스탯 | 파랑 B + 결과 배너.

import { useState } from "react";
import { useGameStore } from "@/store/gameStore";

function resultText(finalResult: string | null, names: [string, string]): string | null {
  if (!finalResult) return null;
  const parts = finalResult.split(/\s+/);
  const winner = parts[1];
  const reason = parts[2];
  const reasonKo =
    reason === "HQ_DESTROYED"
      ? "본부 파괴"
      : reason === "TURN_LIMIT"
        ? "턴 제한"
        : reason === "FORFEIT"
          ? "몰수"
          : "규칙 위반(WA)";
  if (winner === "DRAW") return `무승부 · ${reasonKo}`;
  const who = winner === "LEFT_WIN" ? `A (${names[0]})` : `B (${names[1]})`;
  return `${who} 승리 · ${reasonKo}`;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <label className="block text-[11px] tracking-[0.2em] text-chromedim">{label}</label>
      <b className="text-2xl">{children}</b>
    </div>
  );
}

export default function HeaderBar() {
  const names = useGameStore((s) => s.names);
  const stats = useGameStore((s) => s.stats);
  const viewDay = useGameStore((s) => s.viewDay);
  const states = useGameStore((s) => s.states);
  const finalResult = useGameStore((s) => s.finalResult);
  const anim = useGameStore((s) => s.anim);
  const livePhase = useGameStore((s) => s.live?.phase);
  const [bannerOpen, setBannerOpen] = useState(true);

  const st = stats[viewDay];
  if (!st) return null;

  const atEnd = viewDay === states.length - 1;
  // 마지막 해소 연출이 끝나기 전(및 reveal 커튼 중)엔 승자를 미리 누설하지 않는다
  const banner = anim === null && livePhase !== "reveal" ? resultText(finalResult, names) : null;

  return (
    <div className="z-10">
      <div className="flex items-stretch justify-center bg-chrome">
        <div className="flex min-w-52 items-center justify-start gap-2.5 bg-nred px-5 font-bold">
          <span className="rounded-md bg-white/90 px-2 py-0.5 text-[15px] text-zinc-800">A</span>
          <span>{names[0]}</span>
        </div>
        <div className="flex items-center gap-8 px-8 py-2.5">
          <Stat label="전사">{st.warriors[0]}</Stat>
          <Stat label="골드">
            <span className="text-ngold">{st.gold[0]}</span>
            <em className="ml-1 text-[15px] not-italic text-nincome">+{st.income[0]}</em>
          </Stat>
          <Stat label="기지">
            <span className="text-nred">{st.bases[0]}</span>
          </Stat>
        </div>
        <div className="border-x border-chromeline px-7 py-2 text-center">
          <label className="block text-[11px] tracking-[0.3em] text-chromedim">TURN</label>
          <b className="text-3xl">{viewDay}</b>
        </div>
        <div className="flex items-center gap-8 px-8 py-2.5">
          <Stat label="기지">
            <span className="text-nblue">{st.bases[1]}</span>
          </Stat>
          <Stat label="골드">
            <span className="text-ngold">{st.gold[1]}</span>
            <em className="ml-1 text-[15px] not-italic text-nincome">+{st.income[1]}</em>
          </Stat>
          <Stat label="전사">{st.warriors[1]}</Stat>
        </div>
        <div className="flex min-w-52 items-center justify-end gap-2.5 bg-nblue px-5 font-bold">
          <span>{names[1]}</span>
          <span className="rounded-md bg-white/90 px-2 py-0.5 text-[15px] text-zinc-800">B</span>
        </div>
      </div>
      {banner && atEnd && (
        <div
          className="cursor-pointer border-t border-chromeline bg-chrome2 py-1.5 text-center"
          onClick={() => setBannerOpen(!bannerOpen)}
        >
          {bannerOpen ? (
            <>
              <b className="text-nred">{banner}</b>
              <span className="ml-3 text-[11px] text-chromedim">▲</span>
            </>
          ) : (
            <span className="text-[11px] text-chromedim">▼</span>
          )}
        </div>
      )}
    </div>
  );
}
