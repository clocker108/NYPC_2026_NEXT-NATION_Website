"use client";

// 하단 재생 컨트롤 — ⏮ ◀ ▶ ▶| ⏭ + 속도 + 타임라인(전투 틱 표시).

import { useEffect } from "react";
import { useGameStore, type Speed } from "@/store/gameStore";

const SPEEDS: Speed[] = [0.5, 1, 2, 4, 8, 16];
const BASE_MS_PER_TURN = 500;

const btnCls =
  "h-9 min-w-11 cursor-pointer rounded-lg border border-chromeline bg-chrome2 text-sm text-white hover:border-zinc-500";

export default function PlaybackBar() {
  const states = useGameStore((s) => s.states);
  const viewDay = useGameStore((s) => s.viewDay);
  const playing = useGameStore((s) => s.playing);
  const speed = useGameStore((s) => s.speed);
  const combatTicks = useGameStore((s) => s.combatTicks);
  const setViewDay = useGameStore((s) => s.setViewDay);
  const stepDay = useGameStore((s) => s.stepDay);
  const setPlaying = useGameStore((s) => s.setPlaying);
  const setSpeed = useGameStore((s) => s.setSpeed);

  const maxDay = states.length - 1;

  useEffect(() => {
    if (!playing || maxDay <= 0) return;
    const animated = speed < 4; // 고배속에선 연출 생략하고 점프
    const iv = setInterval(
      () => {
        const st = useGameStore.getState();
        if (st.viewDay >= st.states.length - 1) {
          if (!st.anim) useGameStore.setState({ playing: false });
          return;
        }
        if (animated) {
          st.advanceWithAnim(); // 연출 중이면 no-op — 연출이 페이스를 만든다
        } else {
          useGameStore.setState({ viewDay: st.viewDay + 1, anim: null });
        }
      },
      animated ? 150 : BASE_MS_PER_TURN / speed,
    );
    return () => clearInterval(iv);
  }, [playing, speed, maxDay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // 커튼(교대·모두보기) 중엔 재생 단축키도 잠근다 — 커튼 뒤 상태가 흔들리지 않게
      const ph = useGameStore.getState().live?.phase;
      if (ph === "reveal" || ph === "handover" || ph === "handoverBack") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useGameStore.getState().playing);
      } else if (e.code === "ArrowLeft") stepDay(-1);
      else if (e.code === "ArrowRight") stepDay(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlaying, stepDay]);

  if (maxDay <= 0) return null;

  return (
    <div className="flex items-center gap-4 bg-chrome px-4 py-2.5">
      <div className="flex gap-1.5">
        <button className={btnCls} onClick={() => { setViewDay(0); setPlaying(false); }} title="처음으로">|◀</button>
        <button className={btnCls} onClick={() => stepDay(-1)} title="한 턴 뒤로">◀</button>
        <button className={`${btnCls} min-w-13 text-base`} onClick={() => setPlaying(!playing)} title="재생/정지 (Space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button className={btnCls} onClick={() => stepDay(1)} title="한 턴 앞으로">▶</button>
        <button className={btnCls} onClick={() => { setViewDay(maxDay); setPlaying(false); }} title="끝으로">▶|</button>
      </div>
      <div className="flex gap-1">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={`cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] ${
              sp === speed
                ? "border border-chromeline bg-chrome2 text-white"
                : "border border-transparent text-chromedim hover:text-white"
            }`}
            onClick={() => setSpeed(sp)}
          >
            ×{sp}
          </button>
        ))}
      </div>
      <div className="relative flex h-8 flex-1 items-center">
        <div className="pointer-events-none absolute inset-x-2 inset-y-0 z-[1]">
          {combatTicks.map((d) => (
            <span
              key={d}
              className="absolute top-[21px] h-2 w-[2.5px] bg-nred"
              style={{ left: `${(d / maxDay) * 100}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          className="z-[2] w-full"
          min={0}
          max={maxDay}
          value={viewDay}
          onChange={(e) => setViewDay(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
