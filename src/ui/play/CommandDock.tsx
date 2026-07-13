"use client";

// 명령 독 — 계획 중인 플레이어의 명령 큐/선택 컨텍스트/제출.

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore, planningSide } from "@/store/gameStore";
import { soundManager } from "@/audio/soundManager";
import { warnSecond } from "@/audio/sounds";
import { checkPlan } from "@/engine/plan";
import { bHealCost, bMaxLevel, bNextLevelCost, bTrainCap, hqOf, anyWarriorAt } from "@/engine/state";
import { BASE_BUILD_COST, TRAIN_COST } from "@/engine/constants";
import { commandToLine } from "@/engine/types";

export default function CommandDock() {
  const map = useGameStore((s) => s.map);
  const states = useGameStore((s) => s.states);
  const viewDay = useGameStore((s) => s.viewDay);
  const mode = useGameStore((s) => s.mode);
  const names = useGameStore((s) => s.names);
  const live = useGameStore((s) => s.live);
  const selectedCell = useGameStore((s) => s.selectedCell);
  const setViewDay = useGameStore((s) => s.setViewDay);
  const setSelCount = useGameStore((s) => s.setSelCount);
  const beginDestMode = useGameStore((s) => s.beginDestMode);
  const queueTrain = useGameStore((s) => s.queueTrain);
  const queueUpgrade = useGameStore((s) => s.queueUpgrade);
  const removeQueued = useGameStore((s) => s.removeQueued);
  const clearQueue = useGameStore((s) => s.clearQueue);
  const submitPlan = useGameStore((s) => s.submitPlan);
  const online = useGameStore((s) => s.online);
  const turnDeadline = useGameStore((s) => s.turnDeadline);

  // 턴 제한 마감 — 온라인은 서버 권위(online.deadline), 로컬/AI는 클라 타이머(turnDeadline)
  const deadline = mode === "online" ? (online?.deadline ?? null) : turnDeadline;

  // 카운트다운 틱 (deadline이 있을 때만 0.5초 간격 재렌더) + 로컬/AI 만료 시 자동 제출
  const [, setTick] = useState(0);
  const lastWarnedRef = useRef<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    lastWarnedRef.current = null; // 새 턴/새 마감 — 경고 초 리셋
    const iv = setInterval(() => {
      setTick((t) => t + 1);
      const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const warn = warnSecond(remain, lastWarnedRef.current);
      if (warn !== null) {
        lastWarnedRef.current = warn; // 초는 기록(중복 방지)하되, 온라인에서 이미 제출했으면 소리는 억제
        const submittedOnline = mode === "online" && useGameStore.getState().live?.waiting === true;
        if (!submittedOnline) soundManager.play("warn-time");
      }
      // 온라인은 서버가 빈 턴으로 해소하므로 클라에서는 표시만; 로컬/AI는 여기서 강제 제출
      if (mode !== "online" && Date.now() >= deadline) {
        const s = useGameStore.getState();
        if (s.turnDeadline === deadline && s.live && !s.live.waiting) s.submitPlan();
      }
    }, 500);
    return () => clearInterval(iv);
  }, [deadline, mode]);

  const side = live ? planningSide(live.phase) : null;
  const cur = states[states.length - 1];

  const plan = useMemo(() => {
    if (!map || !cur || side === null || !live) return null;
    return checkPlan(map, cur, side, live.queued);
  }, [map, cur, side, live]);

  if (!map || !cur || !live || side === null) return null;

  const atCurrent = viewDay === states.length - 1;
  if (!atCurrent) {
    return (
      <aside className="flex w-72 flex-col items-center justify-center gap-3 border-l border-chromeline bg-chrome p-4">
        <p className="text-center text-sm text-chromedim">과거 턴을 보는 중입니다</p>
        <button
          className="rounded-lg bg-nblue px-4 py-2 font-bold hover:bg-nbluedark"
          onClick={() => setViewDay(states.length - 1)}
        >
          현재 턴으로 돌아가기
        </button>
      </aside>
    );
  }

  const sideColor = side === 0 ? "text-nred" : "text-nblue";
  const sideBg = side === 0 ? "bg-nred" : "bg-nblue";
  const day = cur.day + 1;
  const goldLeft = plan?.ok ? plan.goldLeft : cur.gold[side];

  // 선택 셀 컨텍스트
  const sel = selectedCell;
  const b = sel !== null ? cur.buildings.get(sel) : undefined;
  const isOwnHq = b?.kind === "HQ" && b.side === side;
  const hq = hqOf(cur, side);
  const trainCap = hq ? bTrainCap(hq) : 0;
  const queuedTrain = live.queued.find((c) => c.type === "TRAIN");
  const trainN = queuedTrain && queuedTrain.type === "TRAIN" ? queuedTrain.n : 0;

  // 업그레이드 후보 판정 (표시용 — 실제 검증은 queueUpgrade에서 엔진으로)
  let upgradeLabel: string | null = null;
  if (sel !== null && map) {
    const isStronghold = map.strongholds.includes(sel);
    const isHqCell = sel === 0 || sel === map.n - 1;
    const friendly = anyWarriorAt(cur, sel, side, true);
    const enemy = anyWarriorAt(cur, sel, side, false);
    const already = live.queued.some((c) => c.type === "UPGRADE" && c.region === sel);
    if (friendly && !enemy && !already && (isStronghold || isHqCell)) {
      if (!b && isStronghold) upgradeLabel = `기지 건설 (−${BASE_BUILD_COST})`;
      else if (b && b.side === side) {
        if (b.level >= bMaxLevel(b)) upgradeLabel = `수리 (−${bHealCost(b)})`;
        else upgradeLabel = `Lv${b.level + 1} 업그레이드 (−${bNextLevelCost(b)})`;
      }
    }
  }

  // 이동 가능 병력
  const queuedMoveSuffixes = new Set(
    live.queued.filter((c) => c.type === "MOVE").map((c) => (c as { suffix: number }).suffix),
  );
  let idleAtSel = 0;
  if (sel !== null) {
    for (const w of cur.warriors.values()) {
      if (w.side === side && w.region === sel && w.hp > 0 && w.movingTarget === null && !queuedMoveSuffixes.has(w.suffix))
        idleAtSel += 1;
    }
  }
  const moveN = Math.min(live.selCount || 1, idleAtSel);

  const costOf = (line: string): number | null => {
    const c = plan?.costs.find((cc) => cc.line === line);
    return c ? c.cost : null;
  };

  return (
    <aside className="flex w-72 flex-col border-l border-chromeline bg-chrome">
      {/* 차례 배너 */}
      <div className={`${sideBg} px-4 py-2.5 text-center font-bold`}>
        {names[side]} — {day}일차 명령
      </div>

      {/* 잔여 골드 */}
      <div className="flex items-center justify-between border-b border-chromeline px-4 py-2.5 text-sm">
        <span className="text-chromedim">명령 후 잔여 골드</span>
        <b className="text-ngold">{goldLeft}</b>
      </div>

      {/* 턴 제한 카운트다운 (모든 라이브 모드) + 온라인 상대 제출 상태 */}
      {(deadline !== null || (mode === "online" && online)) && (
        <div className="flex items-center justify-between border-b border-chromeline px-4 py-2 text-[13px]">
          {(() => {
            const remain = deadline !== null ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
            const mm = remain !== null ? Math.floor(remain / 60) : 0;
            const ss = remain !== null ? String(remain % 60).padStart(2, "0") : "";
            return (
              <span className={remain !== null && remain <= 10 ? "font-bold text-nred" : "text-chromedim"}>
                {remain !== null ? `남은 시간 ${mm}:${ss}` : "시간 제한 없음"}
              </span>
            );
          })()}
          {mode === "online" && online && (
            <span
              className={
                online.peerDown
                  ? "font-bold text-ngold"
                  : online.oppSubmitted
                    ? "text-nincome"
                    : "text-chromedim"
              }
            >
              {online.peerDown ? "⚠ 상대: 연결 끊김" : `상대: ${online.oppSubmitted ? "제출함 ✓" : "계획 중…"}`}
            </span>
          )}
        </div>
      )}

      {/* 선택 컨텍스트 */}
      <div className="border-b border-chromeline px-4 py-3">
        {sel === null ? (
          <p className="text-[13px] leading-relaxed text-chromedim">
            셀을 클릭해 명령을 내리세요.
            <br />· 내 전사가 있는 셀 → 이동
            <br />· 내 본부 → 훈련
            <br />· 거점/건물 → 건설·업그레이드
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <b className="text-sm">셀 #{sel}</b>

            {idleAtSel > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-chromedim">이동</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="h-7 w-7 rounded-md border border-chromeline bg-chrome2"
                      onClick={() => setSelCount(Math.max(1, moveN - 1))}
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-bold">{moveN}</span>
                    <button
                      className="h-7 w-7 rounded-md border border-chromeline bg-chrome2"
                      onClick={() => setSelCount(Math.min(idleAtSel, moveN + 1))}
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[13px] text-chromedim">/ {idleAtSel}명</span>
                  <button
                    className="ml-auto rounded-md border border-chromeline bg-chrome2 px-2.5 py-1 text-[12px] text-chromedim hover:border-zinc-500 hover:text-white"
                    onClick={() => setSelCount(idleAtSel)}
                  >
                    최대
                  </button>
                </div>
                <button
                  className={`rounded-md px-3 py-1.5 text-[13px] font-bold ${live.destMode ? "bg-purple-600" : "bg-chrome2 border border-chromeline hover:border-zinc-500"}`}
                  onClick={beginDestMode}
                >
                  {live.destMode ? "목적지 클릭…" : "목적지 선택"}
                </button>
              </div>
            )}

            {isOwnHq && (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-chromedim">훈련</span>
                <div className="flex items-center gap-1">
                  <button
                    className="h-7 w-7 rounded-md border border-chromeline bg-chrome2"
                    onClick={() => queueTrain(Math.max(0, trainN - 1))}
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-bold">{trainN}</span>
                  <button
                    className="h-7 w-7 rounded-md border border-chromeline bg-chrome2"
                    onClick={() => queueTrain(Math.min(trainCap, trainN + 1))}
                  >
                    +
                  </button>
                </div>
                <span className="ml-auto text-[13px] text-chromedim">
                  최대 {trainCap} · −{TRAIN_COST}/명
                </span>
              </div>
            )}

            {upgradeLabel && (
              <button
                className="rounded-md border border-chromeline bg-chrome2 px-3 py-2 text-[13px] font-bold hover:border-zinc-500"
                onClick={() => queueUpgrade(sel)}
              >
                🔨 {upgradeLabel}
              </button>
            )}

            {idleAtSel === 0 && !isOwnHq && !upgradeLabel && (
              <p className="text-[13px] text-chromedim">이 셀에서 내릴 수 있는 명령이 없습니다.</p>
            )}
          </div>
        )}
      </div>

      {/* 명령 큐 */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <b className="text-sm">명령 목록 ({live.queued.length})</b>
          {live.queued.length > 0 && (
            <button className="text-[12px] text-chromedim hover:text-white" onClick={clearQueue}>
              모두 취소
            </button>
          )}
        </div>
        {live.queued.length === 0 ? (
          <p className="text-[13px] text-chromedim">아직 없음 — 빈 턴도 제출 가능</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {live.queued.map((c, idx) => {
              const line = commandToLine(side, c);
              const cost = costOf(line);
              return (
                <li
                  key={idx}
                  className={`flex items-center gap-2 rounded-md border-l-4 bg-chrome2 px-2.5 py-1.5 text-[13px] ${side === 0 ? "border-nred" : "border-nblue"}`}
                >
                  <span className="font-mono">{line}</span>
                  <span className="ml-auto text-chromedim">{cost === 0 ? "무료" : cost !== null ? `−${cost}` : ""}</span>
                  <button className="text-chromedim hover:text-white" onClick={() => removeQueued(idx)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {live.planError && <p className="mt-2 text-[13px] text-[#ff7b6e]">⚠ {live.planError}</p>}
      </div>

      {/* 제출 */}
      <div className="border-t border-chromeline p-3">
        <button
          data-sfx="menu-click" // 제출 = 확정 액션 — 시작 화면과 같은 도톰한 팝
          className={`${sideBg} w-full rounded-lg py-2.5 font-bold hover:opacity-90 disabled:opacity-50`}
          onClick={submitPlan}
          disabled={live.waiting}
        >
          {live.waiting
            ? mode === "online"
              ? "상대 대기 중…"
              : "봇 응답 대기…"
            : mode === "hotseat" && live.phase === "planA"
              ? "제출 → B에게 넘기기"
              : "제출 → 턴 해소"}
        </button>
        <p className={`mt-1.5 text-center text-[11px] ${sideColor}`}>
          제출 후에는 되돌릴 수 없습니다
        </p>
      </div>
    </aside>
  );
}
