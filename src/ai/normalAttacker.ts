// 보통 · 공격형 — 확장→집결→푸시 미니 FSM + 본부 방어 반사.
// 상태 없는 순수 함수: 페이즈는 게임 상태(날짜·병력·기지 수)에서 유도한다.

import type { BotDriver } from "./types";
import type { Command, Warrior } from "@/engine/types";
import { makeView, distTo, sanitize } from "./helpers";
import { bTrainCap, bWorkCap, hqOf } from "@/engine/state";
import { BASE_BUILD_COST, HQ_LEVELS, TRAIN_COST, UPKEEP_PER, WORK_INCOME } from "@/engine/constants";

const BUILD_RESERVE = BASE_BUILD_COST + 40;

const normalAttacker: BotDriver = {
  id: "normal",
  nameKo: "보통 · 공격형",
  descKo: "확장 후 병력을 모아 본부로 밀고 들어오는 상대",

  getCommands(st, m, side, _rng) {
    const v = makeView(st, m, side);
    const cmds: Command[] = [];
    let gold = v.gold;

    // 홉 근사: 인접 거리 평균으로 "2홉" 판정
    const hopDist = distTo(m, v.myHq, m.adj[v.myHq][0]);

    // ── 방어 반사: 적이 본부 근처(2홉 안쪽)로 오면 전군 소환
    const threat = v.enemies.filter((e) => distTo(m, v.myHq, e.region) <= hopDist * 2.2);
    const defending = threat.length >= 2;

    // ── 확장 목표: 내 쪽 절반 거점의 45%
    const nearTargets = [...v.unclaimedStrongholds]
      .filter((r) => distTo(m, r, v.myHq) < distTo(m, r, v.oppHq) && !v.enemyRegions.has(r))
      .sort((a, b) => distTo(m, a, v.myHq) - distTo(m, b, v.myHq));
    const baseCount = v.myBuildings.length - 1;
    const expandGoal = Math.ceil((m.strongholds.length / 2) * 0.45);
    const expanding = baseCount < expandGoal && st.day < 70 && nearTargets.length > 0;

    // ── 집결 지점: 적 본부에 가장 가까운 내 건물
    const rally = v.myBuildings.reduce(
      (best, r) => (distTo(m, v.oppHq, r) < distTo(m, v.oppHq, best) ? r : best),
      v.myHq,
    );

    // ── 1) 건설/업그레이드 (최우선 지출)
    const upgraded = new Set<number>();
    for (const w of v.idle) {
      if (
        v.unclaimedStrongholds.includes(w.region) &&
        !v.enemyRegions.has(w.region) &&
        !upgraded.has(w.region) &&
        gold >= BASE_BUILD_COST
      ) {
        cmds.push({ type: "UPGRADE", region: w.region });
        upgraded.add(w.region);
        gold -= BASE_BUILD_COST;
      }
    }
    // HQ 레벨업 (확장 끝난 뒤 여유 자금으로)
    const hq = hqOf(st, side);
    if (hq && !defending && !expanding && hq.level < 3 && !upgraded.has(v.myHq)) {
      const cost = HQ_LEVELS[hq.level + 1].upgradeCost;
      const someoneAtHq = v.mine.some((w) => w.region === v.myHq && w.hp > 0);
      if (someoneAtHq && gold >= cost + 300 && !v.enemyRegions.has(v.myHq)) {
        cmds.push({ type: "UPGRADE", region: v.myHq });
        upgraded.add(v.myHq);
        gold -= cost;
      }
    }

    // ── 2) 이동: 일꾼 잔류 → 정착 → 나머지는 군대(집결/푸시)
    const capLeft = new Map<number, number>();
    for (const b of st.buildings.values()) {
      if (b.side === side) capLeft.set(b.region, bWorkCap(b));
    }
    for (const w of v.mine) {
      if (w.movingTarget !== null && capLeft.has(w.movingTarget)) {
        capLeft.set(w.movingTarget, Math.max(0, capLeft.get(w.movingTarget)! - 1));
      }
    }

    const surplus: Warrior[] = [];
    for (const w of v.idle) {
      if (upgraded.has(w.region) && w.region !== v.myHq) continue; // 신축 기지 일꾼
      if (defending) {
        if (w.region !== v.myHq) cmds.push({ type: "MOVE", suffix: w.suffix, region: v.myHq }); // 본부 = 무료
        continue;
      }
      const left = capLeft.get(w.region) ?? 0;
      if (left > 0) {
        capLeft.set(w.region, left - 1);
        continue;
      }
      surplus.push(w);
    }

    const claimMoves = new Set<number>();
    let settlersOut = v.mine.filter(
      (w) => w.movingTarget !== null && v.unclaimedStrongholds.includes(w.movingTarget),
    ).length;
    const army: Warrior[] = [];

    for (const w of surplus) {
      if (expanding) {
        // 빈 노동 슬롯 우선
        let best = -1;
        let bestD = Number.MAX_SAFE_INTEGER;
        for (const [r, slots] of capLeft) {
          if (slots <= 0) continue;
          const d = distTo(m, r, w.region);
          if (d < bestD) {
            bestD = d;
            best = r;
          }
        }
        if (best >= 0) {
          capLeft.set(best, capLeft.get(best)! - 1);
          if (best !== w.region) cmds.push({ type: "MOVE", suffix: w.suffix, region: best });
          continue;
        }
        const t = nearTargets.find((r) => !claimMoves.has(r));
        if (t !== undefined && gold >= 10) {
          claimMoves.add(t);
          settlersOut += 1;
          cmds.push({ type: "MOVE", suffix: w.suffix, region: t });
          gold -= 10;
          continue;
        }
      }
      army.push(w);
    }

    // ── 3) 집결/푸시
    if (!defending && army.length > 0) {
      const oppHqB = st.buildings.get(v.oppHq);
      const defHp = v.enemies
        .filter((e) => distTo(m, v.oppHq, e.region) <= hopDist * 2.2)
        .reduce((s, e) => s + e.hp, 0);
      const turret = oppHqB ? HQ_LEVELS[oppHqB.level].turret : 0;
      const atRally = v.mine.filter((w) => w.region === rally && w.movingTarget === null).length;
      const pushNeed = defHp + turret * 3 + 5;
      const pushing = atRally >= pushNeed || st.day > 160;

      const dest = pushing ? v.oppHq : rally;
      for (const w of army) {
        if (w.region === dest) continue;
        const destB = st.buildings.get(dest);
        const free = destB !== undefined && destB.side === side;
        if (!free && gold < 10) break;
        cmds.push({ type: "MOVE", suffix: w.suffix, region: dest });
        if (!free) gold -= 10;
      }
    }

    // ── 4) 훈련: 유지 가능 범위에서 최대, 건설 예약금 보존
    if (hq && !upgraded.has(v.myHq)) {
      const cap = bTrainCap(hq);
      const totalCap = [...st.buildings.values()]
        .filter((b) => b.side === side)
        .reduce((s, b) => s + bWorkCap(b), 0);
      const alive = v.mine.length;
      const reserve = defending ? 0 : expanding || settlersOut > 0 ? BUILD_RESERVE : 60;
      let n = Math.min(cap, Math.max(0, Math.floor((gold - reserve) / TRAIN_COST)));
      // 아사 가드: 훈련 후에도 수입 ≥ 유지비 (or 골드 넉넉)
      while (n > 0) {
        const projIncome = WORK_INCOME * Math.min(totalCap, alive + n);
        if (projIncome >= UPKEEP_PER * (alive + n) || gold - n * TRAIN_COST >= UPKEEP_PER * (alive + n) * 5) break;
        n -= 1;
      }
      if (n > 0) {
        cmds.push({ type: "TRAIN", n });
        gold -= n * TRAIN_COST;
      }
    }

    return sanitize(m, st, side, cmds);
  },
};

export default normalAttacker;
