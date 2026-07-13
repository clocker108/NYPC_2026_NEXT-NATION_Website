"use client";

// 우측 INFO 패널 — 턴 상세(명령 표) + 셀 상세.

import { useGameStore } from "@/store/gameStore";
import { idStr, sideLetter } from "@/engine/types";
import { bMaxHpNow, bWorkCap } from "@/engine/state";

function TurnDetails() {
  const events = useGameStore((s) => s.events);
  const viewDay = useGameStore((s) => s.viewDay);

  const ev = viewDay > 0 ? events[viewDay - 1] : null;

  return (
    <div className="border-b border-chromeline px-4 py-3">
      <b className="text-sm">턴 상세 {viewDay > 0 ? `(${viewDay}턴)` : ""}</b>
      {!ev ? (
        <p className="mt-1 text-[13px] text-chromedim">0턴 — 시작 상태</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {([0, 1] as const).map((side) => {
            const rows = ev.commandCosts.filter((c) => c.side === side);
            return (
              <div
                key={side}
                className={`rounded-md border-l-4 bg-chrome px-2.5 py-2 ${side === 0 ? "border-nred" : "border-nblue"}`}
              >
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-chromedim">
                      <th className="font-normal">명령</th>
                      <th className="font-normal">인자</th>
                      <th className="text-right font-normal">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-chromedim">
                          (명령 없음)
                        </td>
                      </tr>
                    ) : (
                      rows.map((c, i) => {
                        const parts = c.line.split(" ");
                        return (
                          <tr key={i}>
                            <td className="font-mono">{parts[0]}</td>
                            <td className="font-mono">{parts.slice(1).join(" ")}</td>
                            <td className="text-right tabular-nums">
                              {c.cost === 0 ? <span className="text-nincome">무료</span> : `−${c.cost}`}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CellDetails() {
  const map = useGameStore((s) => s.map);
  const states = useGameStore((s) => s.states);
  const viewDay = useGameStore((s) => s.viewDay);
  const hoverCell = useGameStore((s) => s.hoverCell);
  const selectedCell = useGameStore((s) => s.selectedCell);
  const clickCell = useGameStore((s) => s.clickCell);

  const cell = hoverCell ?? selectedCell;
  const st = states[viewDay];

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <b className="text-sm">셀 상세</b>
      {cell === null || !map || !st ? (
        <p className="mt-1 text-[13px] text-chromedim">셀에 마우스를 올리거나 클릭하세요.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="rounded bg-chrome px-2 py-0.5 font-mono">#{cell}</span>
            <span className="text-chromedim">
              중심 ({map.x[cell]}, {map.y[cell]})
            </span>
            {map.strongholds.includes(cell) && (
              <span className="rounded bg-badge/20 px-1.5 py-0.5 text-[11px] text-badge">거점</span>
            )}
            {(cell === 0 || cell === map.n - 1) && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">본부</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-chromedim">인접</span>
            {map.adj[cell].map((v) => (
              <button
                key={v}
                className="rounded bg-chrome px-1.5 py-0.5 font-mono text-[11.5px] hover:bg-zinc-700"
                onClick={() => clickCell(v)}
              >
                #{v}
              </button>
            ))}
          </div>

          {(() => {
            const b = st.buildings.get(cell);
            if (!b) return null;
            return (
              <div className={`rounded-md px-2.5 py-1.5 ${b.side === 0 ? "bg-nred/15" : "bg-nblue/15"}`}>
                <b>{b.kind === "HQ" ? "본부" : "기지"}</b> Lv{b.level} ·{" "}
                <span className="text-nhp">
                  HP {b.hp}/{bMaxHpNow(b)}
                </span>{" "}
                · 노동 {bWorkCap(b)}명
              </div>
            );
          })()}

          {(() => {
            // 전사 그룹: (측, 목적지)별 묶음
            const groups = new Map<string, { side: 0 | 1; target: number | null; keys: number[] }>();
            for (const w of st.warriors.values()) {
              if (w.region !== cell || w.hp <= 0) continue;
              const gk = `${w.side}:${w.movingTarget ?? "stay"}`;
              let g = groups.get(gk);
              if (!g) {
                g = { side: w.side, target: w.movingTarget, keys: [] };
                groups.set(gk, g);
              }
              g.keys.push(w.key);
            }
            if (groups.size === 0) return <p className="text-chromedim">전사 없음</p>;
            return (
              <div className="flex flex-col gap-1">
                {[...groups.values()].map((g, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded px-2 py-1 ${g.side === 0 ? "bg-nred/15" : "bg-nblue/15"}`}
                  >
                    <b className={g.side === 0 ? "text-nred" : "text-nblue"}>{sideLetter(g.side)}</b>
                    <span>{g.keys.length}명</span>
                    {g.target !== null && <span className="text-chromedim">→ #{g.target}</span>}
                    <span className="ml-auto max-w-32 truncate font-mono text-[11px] text-chromedim">
                      {g.keys.slice(0, 4).map(idStr).join(" ")}
                      {g.keys.length > 4 ? " …" : ""}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default function InfoPanel() {
  return (
    <aside className="no-scrollbar flex w-72 flex-col overflow-y-auto border-l border-chromeline bg-chrome2">
      <b className="px-4 pt-3 text-[13px] tracking-widest text-chromedim">정보</b>
      <TurnDetails />
      <CellDetails />
    </aside>
  );
}
