"use client";

// 좌측 ANALYSIS 패널 — 표시 옵션 + 트렌드 차트 7종.

import { useMemo } from "react";
import { useGameStore } from "@/store/gameStore";
import TrendChart from "./TrendChart";

export default function AnalysisPanel() {
  const stats = useGameStore((s) => s.stats);
  const viewDay = useGameStore((s) => s.viewDay);
  const options = useGameStore((s) => s.options);
  const toggleOption = useGameStore((s) => s.toggleOption);
  const setViewDay = useGameStore((s) => s.setViewDay);
  const names = useGameStore((s) => s.names);

  const series = useMemo(() => {
    const pick = (f: (d: (typeof stats)[number]) => [number, number]) => {
      const a: number[] = [];
      const b: number[] = [];
      for (const d of stats) {
        const [va, vb] = f(d);
        a.push(va);
        b.push(vb);
      }
      return { a, b };
    };
    return {
      warriors: pick((d) => d.warriors),
      income: pick((d) => d.income),
      gold: pick((d) => d.gold),
      cumIncome: pick((d) => d.cumIncome),
      cumSpent: pick((d) => d.cumSpent),
      cumWarriors: pick((d) => d.cumWarriors),
      hqHp: pick((d) => d.hqHp),
    };
  }, [stats]);

  if (stats.length === 0) return null;

  const charts: { title: string; key: keyof typeof series }[] = [
    { title: "전사 수", key: "warriors" },
    { title: "턴당 골드 수입", key: "income" },
    { title: "골드", key: "gold" },
    { title: "누적 골드 수입", key: "cumIncome" },
    { title: "누적 골드 지출", key: "cumSpent" },
    { title: "누적 훈련 전사", key: "cumWarriors" },
    { title: "본부 HP", key: "hqHp" },
  ];

  return (
    <aside className="no-scrollbar flex w-72 flex-col overflow-y-auto border-r border-chromeline bg-chrome2 px-4 py-3">
      <b className="mb-2 text-[13px] tracking-widest text-chromedim">분석</b>

      {/* 표시 옵션 */}
      <div className="mb-3 flex flex-col gap-1.5">
        <b className="text-sm">표시 옵션</b>
        {(
          [
            ["showPaths", "이동 경로 표시"],
            ["showCellNumbers", "셀 번호 표시"],
            ["showEdges", "인접선 표시"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-[13px] text-zinc-300">
            <input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} />
            {label}
          </label>
        ))}
      </div>

      {/* 트렌드 */}
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">추이</b>
        <span className="flex items-center gap-2 text-[11px] text-chromedim">
          <span className="inline-block h-2 w-2 rounded-full bg-nred" /> A {names[0]}
          <span className="ml-1 inline-block h-2 w-2 rounded-full bg-nblue" /> B {names[1]}
        </span>
      </div>
      <div className="flex flex-col gap-3 pb-4">
        {charts.map((c) => (
          <TrendChart
            key={c.key}
            title={c.title}
            a={series[c.key].a}
            b={series[c.key].b}
            viewDay={viewDay}
            onSeek={setViewDay}
          />
        ))}
      </div>
    </aside>
  );
}
