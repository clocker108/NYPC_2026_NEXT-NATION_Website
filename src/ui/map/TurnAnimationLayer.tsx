"use client";

// 턴 해소 연출 (animejs) — 상태는 이미 확정돼 있고, 이 레이어는 이벤트를 "재생"만 한다.
// 베이스 맵은 직전 상태를 그리고, 위에서 턴 해소 순서대로 연출 후 settle:
// 건설/업그레이드 → 이동(칩 슬라이드→도착 합류 카운트업) → 훈련(+n·카운트업)
// → 전투(플래시+피해) → 공성(링+파괴) → 수입 → 아사/전사(† + 카운트다운).
//
// 전사 수 표시 원칙(사용자 피드백): 셀의 전사 수가 변하는 모든 이벤트는
// "변화량 표시 → 최종 수 반영" 순서로 궤적 칩(traj)이 c0→c1→c2→c3을 실시간 표시한다.
//   c0 = 직전 상태(이동분 차감) → c1 = +도착 → c2 = +훈련 → c3 = 최종(-사망)

import { useEffect, useMemo, useRef } from "react";
import { createTimeline } from "animejs";
import { soundManager } from "@/audio/soundManager";
import type { SfxId } from "@/audio/sounds";
import type { MapData } from "@/engine/map";
import type { TurnEvents } from "@/engine/events";
import type { Building, GameState, Side } from "@/engine/types";
import { sideFromKey } from "@/engine/types";
import { WORK_INCOME } from "@/engine/constants";
import { bMaxHpNow } from "@/engine/state";
import { chipGroupPos, collectCells, touchedRegions, type CellInfo } from "./mapDisplay";
import { BuildingGlyph, WarriorChip } from "./Glyphs";

interface Props {
  map: MapData;
  events: TurnEvents;
  baseState: GameState; // 직전 상태 (베이스 렌더와 동일)
  baseCells: Map<number, CellInfo>; // 이동분 차감된 베이스 칩 카운트 (MapView와 동일 객체)
  postState: GameState; // 해소 후 상태 (도착 위치·최종 수 계산용)
  durScale: number; // 1 = 기본, 2 = 2배 빠르게
  onDone: () => void;
}

const RED = "var(--color-nred)";
const BLUE = "var(--color-nblue)";

function sideColor(side: 0 | 1): string {
  return side === 0 ? RED : BLUE;
}

export default function TurnAnimationLayer({ map, events, baseState, baseCells, postState, durScale, onDone }: Props) {
  const rootRef = useRef<SVGGElement>(null);
  const doneRef = useRef(false);
  const tlRef = useRef<ReturnType<typeof createTimeline> | null>(null);
  const builtScaleRef = useRef(1); // 타임라인을 만들 때 쓴 durScale

  // 연출 요소 데이터 (렌더 시점 계산)
  const items = useMemo(() => {
    const cx = (r: number) => map.x[r];
    const cy = (r: number) => map.y[r];
    const postCells = collectCells(postState);

    // 건설/업그레이드/수리: post 상태의 건물 글리프를 덮어씌워 연출
    const bldgs = events.upgrades.map((u, i) => {
      const post = postState.buildings.get(u.region);
      const base = baseState.buildings.get(u.region);
      // BUILD 직후 같은 턴에 파괴된 극단 케이스만 합성값 사용
      const ref: Building =
        post ??
        base ?? { region: u.region, side: u.side, kind: "BASE", level: u.newLevel, hp: 0 };
      const shown: Building = { ...ref, level: u.newLevel };
      return {
        key: `up${i}`,
        x: cx(u.region),
        y: cy(u.region) - 120, // MapView 건물 렌더와 동일 오프셋
        side: u.side,
        kind: ref.kind,
        level: u.newLevel,
        levelFrom: u.kind === "UPGRADE" ? u.newLevel - 1 : undefined,
        hp: post ? post.hp : bMaxHpNow(shown),
        maxHp: bMaxHpNow(shown),
        ukind: u.kind,
        label: u.kind === "BUILD" ? "🔨 건설" : u.kind === "UPGRADE" ? `⬆ Lv${u.newLevel}` : "🔧 수리",
      };
    });

    // ── 전사 수 궤적 준비: 수가 변하는 지역(touched)의 칩 표시는 이 레이어가 소유한다
    //    (MapView는 touched 지역의 베이스 칩을 숨긴다 — 겹침·가림 방지)
    const delta = new Map<string, { arrive: number; train: number; die: number }>();
    const bump = (side: Side, region: number, f: "arrive" | "train" | "die") => {
      const k = `${side}:${region}`;
      let d = delta.get(k);
      if (!d) {
        d = { arrive: 0, train: 0, die: 0 };
        delta.set(k, d);
      }
      d[f] += 1;
    };
    for (const mv of events.moves) bump(sideFromKey(mv.key), mv.to, "arrive");
    for (const t of events.trained) bump(sideFromKey(t.key), t.region, "train");
    for (const d of events.deaths) bump(sideFromKey(d.key), d.region, "die");
    const touched = touchedRegions(events);

    // (region, side)의 턴 내 수 궤적: c0 시작(이동분 차감) → c1 도착 → c2 훈련 → c3 최종(post가 정본)
    const trajOf = (region: number, side: Side): [number, number, number, number] => {
      const d = delta.get(`${side}:${region}`) ?? { arrive: 0, train: 0, die: 0 };
      const c0 = baseCells.get(region)?.warriors[side] ?? 0;
      const c1 = c0 + d.arrive;
      const c2 = c1 + d.train;
      const c3 = postCells.get(region)?.warriors[side] ?? 0;
      return [c0, c1, c2, c3];
    };
    const present = (region: number, side: Side) => trajOf(region, side).some((v) => v > 0);
    // 통합 앵커: 턴 중 어느 시점이든 양측이 공존하면 ±420 오프셋 — 겹쳐 가려지는 일이 없게.
    // y는 post 건물 기준(건설/파괴 반영) → 정착 렌더와 일치.
    const animAnchor = (region: number, side: Side) => {
      const both = present(region, 0) && present(region, 1);
      return {
        x: map.x[region] + (both ? (side === 0 ? -420 : 420) : 0),
        y: map.y[region] + (postState.buildings.has(region) ? 620 : 150),
      };
    };

    // 이동: (출발, 도착, 측)별로 묶어 "숫자 달린 칩"이 통째로 이동
    const moveAgg = new Map<string, { side: 0 | 1; from: number; to: number; count: number }>();
    for (const mv of events.moves) {
      const side = sideFromKey(mv.key);
      const k = `${side}:${mv.from}:${mv.to}`;
      const cur = moveAgg.get(k);
      if (cur) cur.count += 1;
      else moveAgg.set(k, { side, from: mv.from, to: mv.to, count: 1 });
    }
    const moves = [...moveAgg.values()].map((g, i) => {
      // 출발: touched 지역이면 궤적 칩과 같은 통합 앵커, 아니면 베이스 렌더 위치
      const start =
        touched.has(g.from) && present(g.from, g.side)
          ? animAnchor(g.from, g.side)
          : chipGroupPos(map, baseState, baseCells, g.from, g.side);
      const end = animAnchor(g.to, g.side); // 도착지는 항상 touched → 궤적 칩 위치로 합류
      return { key: `mv${i}`, side: g.side, count: g.count, fromX: start.x, fromY: start.y, toX: end.x, toY: end.y };
    });

    // 궤적 칩: touched 지역의 (한 번이라도 존재하는) 모든 측 — 수가 안 변해도 표시를 대신한다
    const chips: {
      key: string;
      side: Side;
      x: number;
      y: number;
      c0: number;
      c1: number;
      c2: number;
      c3: number;
      settle: { x: number; y: number } | null; // 정착 위치가 다르면(상대 전멸 등) 마지막에 슬라이드
    }[] = [];
    let ci = 0;
    for (const region of touched) {
      for (const side of [0, 1] as Side[]) {
        const [c0, c1, c2, c3] = trajOf(region, side);
        if (!(c0 || c1 || c2 || c3)) continue;
        const a = animAnchor(region, side);
        const post = chipGroupPos(map, postState, postCells, region, side);
        const settle = c3 > 0 && (post.x !== a.x || post.y !== a.y) ? post : null;
        chips.push({ key: `tc${ci++}`, side, x: a.x, y: a.y, c0, c1, c2, c3, settle });
      }
    }

    // 훈련 "+n" 플로트
    const spawnAgg = new Map<string, { side: 0 | 1; region: number; count: number }>();
    for (const t of events.trained) {
      const side = sideFromKey(t.key);
      const k = `${side}:${t.region}`;
      const cur = spawnAgg.get(k);
      if (cur) cur.count += 1;
      else spawnAgg.set(k, { side, region: t.region, count: 1 });
    }
    const spawns = [...spawnAgg.values()].map((v, i) => ({
      key: `sp${i}`,
      side: v.side,
      count: v.count,
      x: cx(v.region) + 700,
      y: cy(v.region) + 500,
    }));

    // 전투 플래시: 전투(비-HUNGER) 피해가 발생한 지역들
    const combatRegions = [...new Set(events.damages.filter((d) => d.cause !== "HUNGER").map((d) => d.region))].map(
      (r) => ({ key: `fl${r}`, x: cx(r), y: cy(r) }),
    );

    // 피해 플로트 (지역별 인덱스로 겹침 방지 오프셋)
    const perRegion = new Map<number, number>();
    const dmg = events.damages.map((d, i) => {
      const n = perRegion.get(d.region) ?? 0;
      perRegion.set(d.region, n + 1);
      return {
        key: `dg${i}`,
        hunger: d.cause === "HUNGER",
        victim: sideFromKey(d.key),
        amount: d.amount,
        x: cx(d.region) + (n % 3) * 420 - 420,
        y: cy(d.region) - 150 - Math.floor(n / 3) * 300,
      };
    });

    const sieges = events.sieges.map((s, i) => ({
      key: `sg${i}`,
      x: cx(s.region),
      y: cy(s.region) - 400,
      dealt: s.dealt,
      destroyed: s.destroyed,
      owner: s.side,
    }));

    const incomes = events.incomes.map((inc, i) => ({
      key: `in${i}`,
      x: cx(inc.region) + 500,
      y: cy(inc.region) - 500,
      gold: inc.workers.length * WORK_INCOME,
      side: inc.side,
    }));

    // 사망 표식: 셀·측별 집계 († ×n)
    const deathAgg = new Map<string, { side: 0 | 1; region: number; count: number }>();
    for (const d of events.deaths) {
      const side = sideFromKey(d.key);
      const k = `${side}:${d.region}`;
      const cur = deathAgg.get(k);
      if (cur) cur.count += 1;
      else deathAgg.set(k, { side, region: d.region, count: 1 });
    }
    const deaths = [...deathAgg.values()].map((v, i) => ({
      key: `dt${i}`,
      x: cx(v.region) + (v.side === 0 ? -350 : 350),
      y: cy(v.region) + 150,
      side: v.side,
      count: v.count,
    }));

    return { bldgs, moves, chips, spawns, combatRegions, dmg, sieges, incomes, deaths };
  }, [map, events, baseState, baseCells, postState]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    doneRef.current = false;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };

    const s = 1 / Math.max(0.25, durScale); // durScale 2 → 절반 시간
    const q = (sel: string) => [...root.querySelectorAll(sel)];

    const tl = createTimeline({ defaults: { ease: "outQuad" }, onComplete: finish });
    tlRef.current = tl;
    builtScaleRef.current = Math.max(0.25, durScale);

    // 페이즈 시각표 (raw ms — 실제 위치는 *s)
    const hasUp = items.bldgs.length > 0;
    const upAt = 0;
    const moveRaw = hasUp ? 560 : 0;
    const arriveRaw = moveRaw + 560 + Math.max(0, items.moves.length - 1) * 26; // 모든 칩 도착 시점
    const spawnRaw = items.moves.length > 0 ? arriveRaw + 220 : hasUp ? 620 : 120;
    const combatRaw = spawnRaw + (items.spawns.length > 0 ? 560 : 140);
    const deathRaw = combatRaw + 560; // 아사/전사 표식은 수입(+480~)이 시작된 뒤 — 엔진 순서(수입→보급)와 일치

    // 페이즈 사운드 — 페이즈당 1회, 더미 트윈 onBegin으로 연출과 동기 (스킵=tl.cancel이면 자연 중단)
    const sfxAt = (id: SfxId, at: number) => {
      const o = { v: 0 };
      tl.add(o, { v: 1, duration: 1, onBegin: () => soundManager.play(id) }, at);
    };
    if (items.bldgs.some((b) => b.ukind === "BUILD")) sfxAt("build", upAt);
    if (items.bldgs.some((b) => b.ukind !== "BUILD")) sfxAt("upgrade", upAt + 60 * s);
    if (items.moves.length > 0) sfxAt("move", moveRaw * s);
    if (items.combatRegions.length > 0) sfxAt("combat", combatRaw * s);
    if (items.sieges.some((g) => g.destroyed)) sfxAt("destroy", (combatRaw + 380) * s);

    // 0) 건설/업그레이드/수리: 글리프 팝 + 골드 링 + 라벨, 레벨 뱃지 카운트업
    q("[data-anim='bldg']").forEach((el) => {
      const build = el.getAttribute("data-ukind") === "BUILD";
      tl.add(
        el,
        build
          ? { opacity: [0, 1], scale: [0, 1], duration: 500 * s, ease: "outBack" }
          : { opacity: [0, 1], scale: [1.15, 1], duration: 380 * s },
        upAt,
      );
    });
    q("[data-anim='bldg-ring']").forEach((el) => {
      tl.add(el, { r: [150, 950], opacity: [0.6, 0], duration: 520 * s }, upAt + 60 * s);
    });
    q("[data-anim='bldg-txt']").forEach((el) => {
      tl.add(el, {
        translateY: [0, -420],
        opacity: [{ to: 1, duration: 90 * s }, { to: 1, duration: 420 * s }, { to: 0, duration: 240 * s }],
        duration: 750 * s,
      }, upAt + 80 * s);
    });
    q("[data-anim='lvl']").forEach((el) => {
      const from = Number(el.getAttribute("data-from"));
      const to = Number(el.getAttribute("data-to"));
      const obj = { v: from };
      tl.add(obj, {
        v: to,
        duration: 400 * s,
        ease: "linear",
        onUpdate: () => {
          el.textContent = String(Math.round(obj.v));
        },
      }, upAt + 220 * s);
    });

    // 1) 이동: 숫자 달린 칩이 통째로 슥 이동, 도착하면 궤적 칩에 합류(아래에서 카운트업)
    q("[data-anim='move']").forEach((el, i) => {
      tl.add(el, {
        translateX: Number(el.getAttribute("data-tx")),
        translateY: Number(el.getAttribute("data-ty")),
        duration: 560 * s,
        ease: "inOutQuad",
      }, (moveRaw + i * 26) * s);
      // 각자 자기 도착 시점에 정리 — 늦게 오는 클론을 기다리며 궤적 칩 숫자 위에 겹쳐있지 않게
      tl.add(el, { opacity: 0, duration: 160 * s }, (moveRaw + i * 26 + 560) * s);
    });

    // 2) 전사 수 궤적: 변화량이 생기는 시점마다 실제 숫자가 c0→c1→c2→c3으로 변한다
    q("[data-anim='traj']").forEach((el) => {
      const txt = el.querySelector("[data-anim='traj-count']");
      if (!txt) return;
      const c = [0, 1, 2, 3].map((i) => Number(el.getAttribute(`data-c${i}`)));
      const obj = { v: c[0] };
      const setTxt = () => {
        txt.textContent = String(Math.round(obj.v));
      };
      const stages = [
        { to: c[1], at: arriveRaw, arrive: true }, // 도착 합류
        { to: c[2], at: spawnRaw + 80, arrive: false }, // 훈련 증가
        { to: c[3], at: deathRaw + 120, arrive: false }, // 전투·아사 감소 → 최종 수
      ];
      let cur = c[0];
      let visible = c[0] > 0;
      let free = 0; // 직전 카운트 트윈 종료 raw 시각 — 같은 값에 트윈이 겹치지 않게 순차화
      for (const stg of stages) {
        if (stg.to === cur) continue;
        const at = Math.max(stg.at, free);
        if (stg.arrive && cur === 0) {
          // 빈 셀 도착: 미끄러져 온 칩의 숫자가 그대로 남는 느낌 — 0→n 카운트업 없이 즉시 표시
          tl.add(el, {
            opacity: [0, 1],
            duration: 140 * s,
            onBegin: () => {
              obj.v = stg.to;
              setTxt();
            },
          }, at * s);
          visible = true;
          free = at + 140;
          cur = stg.to;
          continue;
        }
        const dur = Math.min(600, 220 + Math.abs(stg.to - cur) * 180);
        if (!visible && stg.to > 0) {
          tl.add(el, { opacity: [0, 1], duration: 140 * s }, at * s);
          visible = true;
        }
        tl.add(obj, { v: stg.to, duration: dur * s, ease: "linear", onUpdate: setTxt }, at * s);
        free = at + dur;
        cur = stg.to;
      }
      if (cur === 0 && visible) {
        tl.add(el, { opacity: 0, duration: 240 * s }, Math.max(deathRaw + 380, free) * s);
      } else if (el.hasAttribute("data-sx")) {
        // 통합 앵커와 정착 위치가 다르면(상대 전멸로 오프셋 해제 등) 마지막에 슬라이드
        tl.add(el, {
          translateX: Number(el.getAttribute("data-sx")),
          translateY: Number(el.getAttribute("data-sy")),
          duration: 340 * s,
          ease: "inOutQuad",
        }, Math.max(deathRaw + 420, free) * s);
      }
    });

    // 3) 훈련 "+n" 플로트
    q("[data-anim='spawn']").forEach((el, i) => {
      tl.add(el, {
        scale: [0.3, 1.25, 1],
        translateY: [0, -180],
        opacity: [{ to: 1, duration: 100 * s }, { to: 1, duration: 420 * s }, { to: 0, duration: 200 * s }],
        duration: 740 * s,
      }, (spawnRaw + i * 80) * s);
    });

    const combatAt = combatRaw * s;

    // 4) 전투 플래시 링
    q("[data-anim='flash']").forEach((el) => {
      tl.add(el, { r: [140, 1050], opacity: [0.55, 0], duration: 520 * s }, combatAt);
    });

    // 5) 피해 플로트 (전투+아사)
    q("[data-anim='dmg']").forEach((el, i) => {
      tl.add(el, {
        translateY: [0, -650],
        opacity: [{ to: 1, duration: 90 * s }, { to: 1, duration: 380 * s }, { to: 0, duration: 260 * s }],
        duration: 730 * s,
      }, combatAt + (90 + i * 24) * s);
    });

    // 6) 공성 링 + 수치 + 파괴
    q("[data-anim='siege-ring']").forEach((el) => {
      tl.add(el, { r: [120, 800], opacity: [0.7, 0], duration: 460 * s }, combatAt + 260 * s);
    });
    q("[data-anim='siege-txt']").forEach((el) => {
      tl.add(el, {
        translateY: [0, -520],
        opacity: [{ to: 1, duration: 80 * s }, { to: 1, duration: 340 * s }, { to: 0, duration: 220 * s }],
        duration: 640 * s,
      }, combatAt + 300 * s);
    });
    q("[data-anim='boom']").forEach((el) => {
      tl.add(el, {
        scale: [0.3, 1.6],
        opacity: [{ to: 1, duration: 120 * s }, { to: 1, duration: 300 * s }, { to: 0, duration: 260 * s }],
        duration: 680 * s,
      }, combatAt + 380 * s);
    });

    // 7) 수입 플로트
    q("[data-anim='income']").forEach((el, i) => {
      tl.add(el, {
        translateY: [0, -420],
        opacity: [{ to: 0.95, duration: 80 * s }, { to: 0.95, duration: 260 * s }, { to: 0, duration: 200 * s }],
        duration: 540 * s,
      }, combatAt + (480 + i * 18) * s);
    });

    // 8) 사망 표식 († ×n) — 직후 궤적 칩이 최종 수로 감소
    q("[data-anim='death']").forEach((el) => {
      tl.add(el, {
        translateY: [0, -260],
        opacity: [{ to: 0.9, duration: 100 * s }, { to: 0.9, duration: 300 * s }, { to: 0, duration: 240 * s }],
        duration: 640 * s,
      }, deathRaw * s);
    });

    // 아무 연출 대상이 없으면 즉시 종료 (StrictMode 이중 마운트 대비 미세 지연)
    const total =
      items.bldgs.length +
      items.moves.length +
      items.chips.length +
      items.spawns.length +
      items.combatRegions.length +
      items.dmg.length +
      items.sieges.length +
      items.incomes.length +
      items.deaths.length;
    if (total === 0) {
      tl.cancel();
      const t = setTimeout(finish, 0);
      return () => clearTimeout(t);
    }

    // 스킵: Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        tl.cancel();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);

    // cleanup은 타임라인만 취소 — finish()를 부르지 않는다
    // (StrictMode의 mount→cleanup→mount에서 연출이 즉사하는 것 방지;
    //  외부에서 anim을 지워 언마운트된 경우엔 이미 상태가 정리돼 있음)
    return () => {
      window.removeEventListener("keydown", onKey);
      tlRef.current = null;
      tl.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 연출 중 배속 변경을 진행 중인 타임라인에 즉시 반영 (재구축 없이 재생 속도만 조정)
  useEffect(() => {
    const tl = tlRef.current;
    if (tl) tl.speed = Math.max(0.25, durScale) / builtScaleRef.current;
  }, [durScale]);

  return (
    <g ref={rootRef} pointerEvents="none">
      {/* 건설/업그레이드/수리 — post 건물 글리프 팝 + 링 + 라벨 */}
      {items.bldgs.map((b) => (
        <g key={b.key} transform={`translate(${b.x},${b.y})`}>
          <circle data-anim="bldg-ring" cx={0} cy={-250} r={150} fill="none" stroke="var(--color-ngold)" strokeWidth={100} opacity={0} />
          <g data-anim="bldg" data-ukind={b.ukind} style={{ opacity: 0, transformBox: "fill-box", transformOrigin: "center" }}>
            <BuildingGlyph x={0} y={0} side={b.side} kind={b.kind} level={b.level} hp={b.hp} maxHp={b.maxHp} levelFrom={b.levelFrom} />
          </g>
          <text
            data-anim="bldg-txt"
            x={0}
            y={-900}
            fontSize={380}
            fontWeight={900}
            textAnchor="middle"
            fill="var(--color-ngold)"
            stroke="#3a2c05"
            strokeWidth={60}
            paintOrder="stroke"
            style={{ opacity: 0 }}
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* 이동 그룹 — 숫자 달린 칩 통째 이동 */}
      {items.moves.map((mv) => (
        <WarriorChip
          key={mv.key}
          side={mv.side}
          count={mv.count}
          groupProps={{
            "data-anim": "move",
            "data-tx": mv.toX,
            "data-ty": mv.toY,
            style: { transform: `translate(${mv.fromX}px, ${mv.fromY}px)` },
          }}
        />
      ))}

      {/* 전사 수 궤적 칩 — touched 지역 칩 표시를 소유. 도착/훈련/사망 시점마다 실제 숫자가 변하고,
          필요하면 마지막에 정착 위치로 슬라이드한다 (CSS transform 배치 = 이동 가능) */}
      {items.chips.map((tc) => (
        <WarriorChip
          key={tc.key}
          side={tc.side}
          count={tc.c0}
          groupProps={{
            "data-anim": "traj",
            "data-c0": tc.c0,
            "data-c1": tc.c1,
            "data-c2": tc.c2,
            "data-c3": tc.c3,
            "data-sx": tc.settle ? tc.settle.x : undefined,
            "data-sy": tc.settle ? tc.settle.y : undefined,
            style: { opacity: tc.c0 > 0 ? 1 : 0, transform: `translate(${tc.x}px, ${tc.y}px)` },
          }}
          countProps={{ "data-anim": "traj-count" }}
        />
      ))}

      {/* 훈련 "+n" 플로트 */}
      {items.spawns.map((sp) => (
        <g key={sp.key} transform={`translate(${sp.x},${sp.y})`}>
          <text
            data-anim="spawn"
            x={0}
            y={0}
            fontSize={400}
            fontWeight={900}
            textAnchor="middle"
            fill={sideColor(sp.side)}
            stroke="#fff"
            strokeWidth={80}
            paintOrder="stroke"
            style={{ opacity: 0, transformBox: "fill-box", transformOrigin: "center" }}
          >
            +{sp.count}
          </text>
        </g>
      ))}

      {/* 전투 플래시 */}
      {items.combatRegions.map((f) => (
        <circle key={f.key} data-anim="flash" cx={f.x} cy={f.y} r={140} fill="none" stroke="#fff" strokeWidth={90} opacity={0} />
      ))}

      {/* 피해 플로트 */}
      {items.dmg.map((d) => (
        <text
          key={d.key}
          data-anim="dmg"
          x={d.x}
          y={d.y}
          fontSize={d.hunger ? 320 : 400}
          fontWeight={800}
          textAnchor="middle"
          fill={d.hunger ? "#8a4a3a" : sideColor(d.victim)}
          stroke="#fff"
          strokeWidth={70}
          paintOrder="stroke"
          style={{ opacity: 0 }}
        >
          {d.hunger ? `🍖-${d.amount}` : `-${d.amount}`}
        </text>
      ))}

      {/* 공성 */}
      {items.sieges.map((sg) => (
        <g key={sg.key}>
          <circle data-anim="siege-ring" cx={sg.x} cy={sg.y + 300} r={120} fill="none" stroke="var(--color-ngold)" strokeWidth={110} opacity={0} />
          <text
            data-anim="siege-txt"
            x={sg.x}
            y={sg.y}
            fontSize={440}
            fontWeight={900}
            textAnchor="middle"
            fill="#e67e22"
            stroke="#fff"
            strokeWidth={80}
            paintOrder="stroke"
            style={{ opacity: 0 }}
          >
            🏰-{sg.dealt}
          </text>
          {sg.destroyed && (
            <text
              data-anim="boom"
              x={sg.x}
              y={sg.y + 350}
              fontSize={700}
              textAnchor="middle"
              style={{ opacity: 0, transformBox: "fill-box", transformOrigin: "center" }}
            >
              💥
            </text>
          )}
        </g>
      ))}

      {/* 수입 플로트 */}
      {items.incomes.map((inc) => (
        <text
          key={inc.key}
          data-anim="income"
          x={inc.x}
          y={inc.y}
          fontSize={280}
          fontWeight={700}
          textAnchor="middle"
          fill="var(--color-ngold)"
          stroke="#3a2c05"
          strokeWidth={40}
          paintOrder="stroke"
          style={{ opacity: 0 }}
        >
          +{inc.gold}
        </text>
      ))}

      {/* 사망 표식 (셀·측별 집계) */}
      {items.deaths.map((d) => (
        <text
          key={d.key}
          data-anim="death"
          x={d.x}
          y={d.y}
          fontSize={380}
          fontWeight={800}
          textAnchor="middle"
          fill="#555"
          stroke="#fff"
          strokeWidth={60}
          paintOrder="stroke"
          style={{ opacity: 0 }}
        >
          {d.count > 1 ? `† ×${d.count}` : "†"}
        </text>
      ))}
    </g>
  );
}
