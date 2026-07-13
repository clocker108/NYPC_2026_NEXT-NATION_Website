// 쉬움 · 성장형 — 가까운 거점을 천천히 점령하고 노동만 채우는 수비적 AI.
// 교전을 피하므로 공격하면 이길 수 있는 입문용 상대.

import type { BotDriver } from "./types";
import type { Command, Warrior } from "@/engine/types";
import { makeView, distTo, sanitize } from "./helpers";
import { bTrainCap, bWorkCap, hqOf } from "@/engine/state";
import { BASE_BUILD_COST, TRAIN_COST, UPKEEP_PER, WORK_INCOME } from "@/engine/constants";

const BUILD_RESERVE = BASE_BUILD_COST + 40;

const easyGrower: BotDriver = {
  id: "easy",
  nameKo: "쉬움 · 성장형",
  descKo: "천천히 확장하고 방어만 하는 입문용 상대",

  getCommands(st, m, side, _rng) {
    const v = makeView(st, m, side);
    const cmds: Command[] = [];
    let gold = v.gold;

    // 목표 거점: 내 본부에서 가까운 순 1/3
    const targets = [...v.unclaimedStrongholds]
      .filter((r) => !v.enemyRegions.has(r))
      .sort((a, b) => distTo(m, a, v.myHq) - distTo(m, b, v.myHq))
      .slice(0, Math.max(1, Math.ceil(m.strongholds.length / 3)));

    // 1) 건설: 빈 거점 위에 서 있으면 기지 건설 (최우선 지출)
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

    // 2) 이동: 건물별 work_cap만큼만 잔류, 잉여는 빈 슬롯 → 정착 순
    const capLeft = new Map<number, number>();
    for (const b of st.buildings.values()) {
      if (b.side === side) capLeft.set(b.region, bWorkCap(b));
    }
    // 이동 중인 전사의 목적지 슬롯 선점
    for (const w of v.mine) {
      if (w.movingTarget !== null && capLeft.has(w.movingTarget)) {
        capLeft.set(w.movingTarget, Math.max(0, capLeft.get(w.movingTarget)! - 1));
      }
    }

    const surplus: Warrior[] = [];
    for (const w of v.idle) {
      if (upgraded.has(w.region)) continue; // 건설자는 자리 유지 (새 기지 일꾼이 됨)
      const left = capLeft.get(w.region) ?? 0;
      if (left > 0) {
        capLeft.set(w.region, left - 1); // 잔류 일꾼
        continue;
      }
      surplus.push(w);
    }

    const claimMoves = new Set<number>();
    let settlersOut = v.mine.filter((w) => w.movingTarget !== null && targets.includes(w.movingTarget)).length;
    for (const w of surplus) {
      // 가장 가까운 빈 노동 슬롯
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
        if (best !== w.region) cmds.push({ type: "MOVE", suffix: w.suffix, region: best }); // 아군 건물 → 무료
        continue;
      }
      // 정착민 (셀당 1명)
      const t = targets.find((r) => !claimMoves.has(r));
      if (t !== undefined && gold >= 10) {
        claimMoves.add(t);
        settlersOut += 1;
        cmds.push({ type: "MOVE", suffix: w.suffix, region: t });
        gold -= 10;
      }
    }

    // 3) 훈련: 유지 가능 + 건설 예약금 확보 시에만 1명
    const hq = hqOf(st, side);
    if (hq) {
      const cap = bTrainCap(hq);
      const totalCap = [...st.buildings.values()]
        .filter((b) => b.side === side)
        .reduce((s, b) => s + bWorkCap(b), 0);
      const alive = v.mine.length;
      const projIncome = WORK_INCOME * Math.min(totalCap, alive + 1);
      const sustainable = projIncome >= UPKEEP_PER * (alive + 1) + 4;
      const needMore = alive < totalCap + Math.min(2, targets.length);
      const reserve = settlersOut > 0 || targets.length > 0 ? BUILD_RESERVE : 60;
      if (cap > 0 && needMore && sustainable && gold >= TRAIN_COST + reserve) {
        cmds.push({ type: "TRAIN", n: 1 });
        gold -= TRAIN_COST;
      }
    }

    return sanitize(m, st, side, cmds);
  },
};

export default easyGrower;
