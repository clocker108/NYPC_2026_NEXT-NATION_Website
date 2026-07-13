// 턴 해소 코어 — engine/testing-tool.py의 run_game 한 턴을 충실 포팅.
// 해소 순서: 1페이즈(LEFT 전체→RIGHT 전체; UPGRADE→MOVE→TRAIN요금)
//   → 이동 → 훈련 스폰 → 전투 → 공성 → 노동 → 보급(+일괄 사망 제거) → 승리판정.

import {
  BASE_BUILD_COST,
  BASE_LEVELS,
  MAX_DAYS,
  MOVE_COST,
  TRAIN_COST,
  UPKEEP_PER,
  WORK_INCOME,
  hqWarriorHp,
} from "./constants";
import type { MapData } from "./map";
import { bfsReachable, edgeWeight, dijkstraFrom } from "./map";
import {
  anyWarriorAt,
  bHealCost,
  bMaxHpNow,
  bMaxLevel,
  bNextLevelCost,
  bTrainCap,
  bTurret,
  bWorkCap,
  cloneState,
  hqOf,
} from "./state";
import type { DamageCause, TurnEvents } from "./events";
import { emptyEvents } from "./events";
import type { GameState, Side, WKey, Winner } from "./types";
import { idStr, sideFromKey, suffixFromKey, wkey } from "./types";

// ── 제출 파싱 (parse_block 포팅) ─────────────────────────────────────────
export class WaError extends Error {
  constructor(public side: Side, public msg: string) {
    super(msg);
  }
}

export interface Submission {
  hasTrain: boolean;
  trainN: number;
  upgrades: number[];
  moves: [number, number][]; // (suffix, target)
}

function parseWarriorToken(side: Side, tok: string): number {
  if (tok.length < 2) throw new WaError(side, `bad warrior id: ${tok}`);
  const letter = tok[0];
  if (letter !== "A" && letter !== "B") throw new WaError(side, `bad warrior id prefix: ${tok}`);
  const parsedSide: Side = letter === "A" ? 0 : 1;
  if (parsedSide !== side) throw new WaError(side, `warrior id from wrong side: ${tok}`);
  const digits = tok.slice(1);
  if (!/^-?\d+$/.test(digits)) throw new WaError(side, `bad warrior id digits: ${tok}`);
  const suffix = parseInt(digits, 10);
  if (suffix <= 0 || suffix > 1_000_000) throw new WaError(side, `warrior id out of range: ${tok}`);
  return suffix;
}

function parseIntStrict(side: Side, tok: string, what: string): number {
  if (!/^-?\d+$/.test(tok)) throw new WaError(side, `${what}: bad number: ${tok}`);
  return parseInt(tok, 10);
}

export function parseBlock(side: Side, lines: string[]): Submission {
  const sub: Submission = { hasTrain: false, trainN: 0, upgrades: [], moves: [] };
  const movedKeys = new Set<number>();
  const upgradeRegions = new Set<number>();

  for (const raw of lines) {
    const parts = raw.split(/\s+/).filter((p) => p.length > 0);
    if (parts.length === 0) throw new WaError(side, "empty command line");
    const verb = parts[0];

    if (verb === "MOVE") {
      if (parts.length !== 3) throw new WaError(side, `MOVE: expected \`<id> <region>\`, got: ${raw}`);
      const suffix = parseWarriorToken(side, parts[1]);
      const target = parseIntStrict(side, parts[2], "MOVE target");
      const key = wkey(side, suffix);
      if (movedKeys.has(key)) throw new WaError(side, `duplicate MOVE for ${parts[1]}`);
      movedKeys.add(key);
      sub.moves.push([suffix, target]);
    } else if (verb === "TRAIN") {
      if (parts.length !== 2) throw new WaError(side, `TRAIN: expected \`<n>\`, got: ${raw}`);
      if (sub.hasTrain) throw new WaError(side, "duplicate TRAIN line");
      sub.trainN = parseIntStrict(side, parts[1], "TRAIN n");
      sub.hasTrain = true;
    } else if (verb === "UPGRADE") {
      if (parts.length !== 2) throw new WaError(side, `UPGRADE: expected \`<region>\`, got: ${raw}`);
      const r = parseIntStrict(side, parts[1], "UPGRADE region");
      if (upgradeRegions.has(r)) throw new WaError(side, `duplicate UPGRADE for region ${r}`);
      upgradeRegions.add(r);
      sub.upgrades.push(r);
    } else {
      throw new WaError(side, `unknown command verb: ${verb}`);
    }
  }
  return sub;
}

// ── 1페이즈: UPGRADE → MOVE → TRAIN 요금 ────────────────────────────────
function applyUpgrades(
  st: GameState,
  m: MapData,
  side: Side,
  sub: Submission,
  ev: TurnEvents,
): void {
  const hqs = new Set([0, m.n - 1]);
  const strongholdSet = new Set(m.strongholds);

  for (const r of sub.upgrades) {
    if (r < 0 || r >= m.n) throw new WaError(side, `UPGRADE region out of range: ${r}`);
    if (!hqs.has(r) && !strongholdSet.has(r))
      throw new WaError(side, `UPGRADE: not a stronghold or HQ region: ${r}`);
    if (anyWarriorAt(st, r, side, false)) throw new WaError(side, `UPGRADE: enemy warrior present at ${r}`);
    if (!anyWarriorAt(st, r, side, true)) throw new WaError(side, `UPGRADE without friendly warrior at ${r}`);

    const b = st.buildings.get(r);
    if (!b) {
      if (hqs.has(r)) throw new WaError(side, `UPGRADE: cannot BUILD on HQ region ${r}`);
      if (st.gold[side] < BASE_BUILD_COST) throw new WaError(side, "UPGRADE (build) insufficient gold");
      st.gold[side] -= BASE_BUILD_COST;
      ev.spentTotal[side] += BASE_BUILD_COST;
      st.buildings.set(r, { region: r, side, kind: "BASE", level: 1, hp: BASE_LEVELS[1].hp });
      ev.upgrades.push({ region: r, side, kind: "BUILD", newLevel: 1 });
      ev.commandCosts.push({ side, line: `UPGRADE ${r}`, cost: BASE_BUILD_COST });
    } else {
      if (b.side !== side) throw new WaError(side, `UPGRADE: enemy-owned building at ${r}`);
      if (b.level >= bMaxLevel(b)) {
        const cost = bHealCost(b);
        if (st.gold[side] < cost) throw new WaError(side, "UPGRADE (heal): insufficient gold");
        st.gold[side] -= cost;
        ev.spentTotal[side] += cost;
        b.hp = bMaxHpNow(b);
        ev.upgrades.push({ region: r, side, kind: "HEAL", newLevel: b.level });
        ev.commandCosts.push({ side, line: `UPGRADE ${r}`, cost });
      } else {
        const cost = bNextLevelCost(b);
        if (st.gold[side] < cost) throw new WaError(side, "UPGRADE: insufficient gold");
        st.gold[side] -= cost;
        ev.spentTotal[side] += cost;
        b.level += 1;
        b.hp = bMaxHpNow(b);
        ev.upgrades.push({ region: r, side, kind: "UPGRADE", newLevel: b.level });
        ev.commandCosts.push({ side, line: `UPGRADE ${r}`, cost });
      }
    }
  }
}

function applyMoves(st: GameState, m: MapData, side: Side, sub: Submission, ev: TurnEvents): void {
  for (const [suffix, target] of sub.moves) {
    const key = wkey(side, suffix);
    const w = st.warriors.get(key);
    if (!w) throw new WaError(side, `MOVE: unknown warrior ${idStr(key)}`);
    if (w.hp <= 0) throw new WaError(side, `MOVE: dead warrior ${idStr(key)}`);
    if (w.movingTarget !== null) throw new WaError(side, `MOVE: warrior already moving ${idStr(key)}`);
    if (target < 0 || target >= m.n) throw new WaError(side, `MOVE: target out of range: ${target}`);
    if (!bfsReachable(m, w.region, target)) throw new WaError(side, `MOVE: unreachable target ${target}`);

    const b = st.buildings.get(target);
    const cost = b && b.side === side ? 0 : MOVE_COST;
    if (st.gold[side] < cost) throw new WaError(side, "MOVE: insufficient gold");
    st.gold[side] -= cost;
    ev.spentTotal[side] += cost;
    w.movingTarget = target;
    ev.commandCosts.push({ side, line: `MOVE ${idStr(key)} ${target}`, cost });
  }
}

function applyTrainCharge(st: GameState, side: Side, sub: Submission, ev: TurnEvents): number {
  if (!sub.hasTrain) return 0;
  const n = sub.trainN;
  const hq = hqOf(st, side);
  if (!hq) throw new WaError(side, "TRAIN after HQ destroyed");
  if (n < 0) throw new WaError(side, "TRAIN n must be >= 0");
  if (n === 0) return 0;
  if (n > bTrainCap(hq)) throw new WaError(side, "TRAIN exceeds HQ train cap");
  const cost = n * TRAIN_COST;
  if (cost > st.gold[side]) throw new WaError(side, "TRAIN insufficient gold");
  st.gold[side] -= cost;
  ev.spentTotal[side] += cost;
  ev.commandCosts.push({ side, line: `TRAIN ${n}`, cost });
  return n;
}

// ── 해소 단계들 ──────────────────────────────────────────────────────────
function spawnTrained(st: GameState, side: Side, n: number, ev: TurnEvents): void {
  if (n === 0) return;
  const hq = hqOf(st, side)!;
  const whp = hqWarriorHp(hq.level);
  for (let i = 0; i < n; i++) {
    const sfx = st.nextSuffix[side];
    st.nextSuffix[side] += 1;
    const k = wkey(side, sfx);
    st.warriors.set(k, { key: k, side, suffix: sfx, region: hq.region, hp: whp, movingTarget: null });
    ev.trained.push({ key: k, region: hq.region, hp: whp });
  }
}

function applyDayMovement(st: GameState, m: MapData, ev: TurnEvents): void {
  // 적 위치 스냅샷 (홉 이전 일괄 — 이번 턴 떠나는 적도 핀함)
  const enemyOfLeft = new Set<number>();
  const enemyOfRight = new Set<number>();
  for (const w of st.warriors.values()) {
    if (w.hp <= 0) continue;
    if (w.side === 1) enemyOfLeft.add(w.region);
    else enemyOfRight.add(w.region);
  }

  for (const w of st.warriors.values()) {
    if (w.hp <= 0 || w.movingTarget === null) continue;
    const t = w.movingTarget;
    if (w.region === t) {
      w.movingTarget = null; // MOVE 이벤트 없음 (엔진 동일)
      continue;
    }
    const enemySet = w.side === 0 ? enemyOfLeft : enemyOfRight;
    if (enemySet.has(w.region)) {
      ev.pinned.push(w.key);
      continue;
    }
    const dist = dijkstraFrom(m, t);
    let bestV = -1;
    let bestScore = -1;
    for (const v of m.adj[w.region]) {
      if (dist[v] < 0) continue;
      const score = edgeWeight(m, w.region, v) + dist[v];
      if (bestScore < 0 || score < bestScore) {
        bestScore = score;
        bestV = v;
      }
    }
    if (bestV < 0) continue;
    const from = w.region;
    w.region = bestV;
    const arrived = w.region === t;
    ev.moves.push({ key: w.key, from, to: bestV, arrived });
    if (arrived) w.movingTarget = null;
  }
}

// 단일 피해 틱: 해당 지역 side측 전사 중 HP최저(동률=번호최저) -1. 없으면 null.
function damageTick(st: GameState, region: number, side: Side): WKey | null {
  let bestKey: WKey = 0;
  let bestHp = -1;
  let found = false;
  for (const [k, w] of st.warriors) {
    if (w.region !== region || w.side !== side || w.hp <= 0) continue;
    if (!found || w.hp < bestHp || (w.hp === bestHp && suffixFromKey(k) < suffixFromKey(bestKey))) {
      bestHp = w.hp;
      bestKey = k;
      found = true;
    }
  }
  if (!found) return null;
  st.warriors.get(bestKey)!.hp -= 1;
  return bestKey;
}

function applyDayCombat(st: GameState, ev: TurnEvents, siegeDamage: Map<number, number>): void {
  const counts = new Map<number, [number, number]>();
  for (const w of st.warriors.values()) {
    if (w.hp > 0) {
      let c = counts.get(w.region);
      if (!c) {
        c = [0, 0];
        counts.set(w.region, c);
      }
      c[w.side] += 1;
    }
  }
  for (const r of st.buildings.keys()) {
    if (!counts.has(r)) counts.set(r, [0, 0]);
  }

  // (cause,key) 병합 누적 + region 기록(애니메이션용)
  const dmgAccum = new Map<string, { cause: DamageCause; key: WKey; amount: number; region: number }>();
  const accum = (cause: DamageCause, key: WKey, region: number) => {
    const id = `${cause}:${key}`;
    const cur = dmgAccum.get(id);
    if (cur) cur.amount += 1;
    else dmgAccum.set(id, { cause, key, amount: 1, region });
  };

  const regions = [...counts.keys()].sort((a, b) => a - b);
  for (const region of regions) {
    const [lc, rc] = counts.get(region)!;
    const b = st.buildings.get(region);
    const bIsLeft = b !== undefined && b.side === 0;
    const bIsRight = b !== undefined && b.side === 1;
    const turretVal = b ? bTurret(b) : 0;

    const leftPresent = lc > 0 || bIsLeft;
    const rightPresent = rc > 0 || bIsRight;
    if (!(leftPresent && rightPresent)) continue;

    const leftCap = lc + (bIsLeft ? turretVal : 0);
    const rightCap = rc + (bIsRight ? turretVal : 0);

    let leftIdle = 0;
    for (let i = 0; i < leftCap; i++) {
      const cause: DamageCause = bIsLeft && i < turretVal ? "TURRET" : "COMBAT";
      const k = damageTick(st, region, 1);
      if (k === null) leftIdle += 1;
      else accum(cause, k, region);
    }

    let rightIdle = 0;
    for (let i = 0; i < rightCap; i++) {
      const cause: DamageCause = bIsRight && i < turretVal ? "TURRET" : "COMBAT";
      const k = damageTick(st, region, 0);
      if (k === null) rightIdle += 1;
      else accum(cause, k, region);
    }

    if (b) {
      const attackerIdle = b.side === 0 ? rightIdle : leftIdle;
      if (attackerIdle > 0) siegeDamage.set(region, attackerIdle);
    }
  }

  for (const d of dmgAccum.values()) ev.damages.push(d);
}

function applyDaySiege(st: GameState, ev: TurnEvents, siegeDamage: Map<number, number>): void {
  const regions = [...st.buildings.keys()].sort((a, b) => a - b);
  const destroyed: number[] = [];
  for (const r of regions) {
    const dmg = siegeDamage.get(r) ?? 0;
    if (dmg <= 0) continue;
    const b = st.buildings.get(r)!;
    const dealt = Math.min(dmg, b.hp);
    b.hp -= dealt;
    const isDestroyed = b.hp <= 0;
    ev.sieges.push({ side: b.side, region: r, dealt, destroyed: isDestroyed });
    if (isDestroyed) destroyed.push(r);
  }
  for (const r of destroyed) st.buildings.delete(r);
}

function applyEveningWork(st: GameState, ev: TurnEvents): void {
  const consumed = new Set<WKey>();
  const regions = [...st.buildings.keys()].sort((a, b) => a - b);
  for (const r of regions) {
    const b = st.buildings.get(r)!;
    const eligible: WKey[] = [];
    for (const [k, w] of st.warriors) {
      if (w.side === b.side && w.region === r && w.hp > 0 && !consumed.has(k)) eligible.push(k);
    }
    eligible.sort((a, c) => {
      const sa = sideFromKey(a), sc = sideFromKey(c);
      if (sa !== sc) return sa - sc;
      return suffixFromKey(a) - suffixFromKey(c);
    });
    const take = Math.min(bWorkCap(b), eligible.length);
    if (take > 0) {
      const workers = eligible.slice(0, take);
      for (const k of workers) consumed.add(k);
      st.gold[b.side] += WORK_INCOME * take;
      ev.incomeTotal[b.side] += WORK_INCOME * take;
      ev.incomes.push({ side: b.side, region: r, workers });
    }
  }
}

function applyEveningUpkeep(st: GameState, ev: TurnEvents): void {
  for (const side of [0, 1] as Side[]) {
    const aliveKeys: WKey[] = [];
    for (const [k, w] of st.warriors) {
      if (w.side === side && w.hp > 0) aliveKeys.push(k);
    }
    aliveKeys.sort((a, b) => suffixFromKey(a) - suffixFromKey(b));
    for (const k of aliveKeys) {
      const w = st.warriors.get(k)!;
      if (st.gold[side] >= UPKEEP_PER) {
        st.gold[side] -= UPKEEP_PER;
      } else {
        w.hp -= 1;
        ev.damages.push({ cause: "HUNGER", key: k, amount: 1, region: w.region });
      }
    }
  }
  const dead: WKey[] = [];
  for (const [k, w] of st.warriors) {
    if (w.hp <= 0) dead.push(k);
  }
  for (const k of dead) {
    ev.deaths.push({ key: k, region: st.warriors.get(k)!.region });
    st.warriors.delete(k);
  }
}

// ── 승리 판정 (run_game 말미 포팅) ───────────────────────────────────────
export function computeFinalResult(st: GameState): { winner: Winner; reason: "HQ_DESTROYED" | "TURN_LIMIT" } {
  const leftHq = hqOf(st, 0);
  const rightHq = hqOf(st, 1);
  const leftAlive = leftHq !== null;
  const rightAlive = rightHq !== null;
  const leftHp = leftAlive ? leftHq.hp : 0;
  const rightHp = rightAlive ? rightHq.hp : 0;
  const reason = leftAlive && rightAlive ? "TURN_LIMIT" : "HQ_DESTROYED";

  const cmp =
    (leftAlive ? 1 : 0) - (rightAlive ? 1 : 0) || leftHp - rightHp;
  const winner: Winner = cmp > 0 ? "LEFT_WIN" : cmp < 0 ? "RIGHT_WIN" : "DRAW";
  return { winner, reason };
}

// ── 메인: 한 턴 적용 ────────────────────────────────────────────────────
export interface ApplyTurnResult {
  state: GameState;
  events: TurnEvents;
}

/**
 * 한 턴을 해소한다. 입력은 양측의 원시 명령 라인(제출 블록 내용).
 * 반환된 state는 새 객체(원본 불변). 게임 종료 시 state.result가 세팅된다.
 */
export function applyTurn(m: MapData, prev: GameState, blocks: [string[], string[]]): ApplyTurnResult {
  const st = cloneState(prev);
  st.day = prev.day + 1;
  const ev = emptyEvents(st.day);

  // 1페이즈 (LEFT 전체 → RIGHT 전체), WA는 측별로 수집
  const waMsg: Partial<Record<Side, string>> = {};
  const trainN: [number, number] = [0, 0];
  for (const side of [0, 1] as Side[]) {
    try {
      const sub = parseBlock(side, blocks[side]);
      applyUpgrades(st, m, side, sub, ev);
      applyMoves(st, m, side, sub, ev);
      trainN[side] = applyTrainCharge(st, side, sub, ev);
    } catch (e) {
      if (e instanceof WaError) waMsg[side] = e.msg;
      else throw e;
    }
  }

  const badL = waMsg[0] !== undefined;
  const badR = waMsg[1] !== undefined;
  if (badL || badR) {
    const loser: Side | "BOTH" = badL && badR ? "BOTH" : badL ? 0 : 1;
    ev.wa = { loser, messages: waMsg };
    st.result =
      loser === "BOTH"
        ? { winner: "DRAW", reason: "WA" }
        : { winner: loser === 0 ? "RIGHT_WIN" : "LEFT_WIN", reason: "WA" };
    ev.goldAfter = [st.gold[0], st.gold[1]];
    return { state: st, events: ev };
  }

  const siegeDamage = new Map<number, number>();
  applyDayMovement(st, m, ev);
  spawnTrained(st, 0, trainN[0], ev);
  spawnTrained(st, 1, trainN[1], ev);
  applyDayCombat(st, ev, siegeDamage);
  applyDaySiege(st, ev, siegeDamage);
  applyEveningWork(st, ev);
  applyEveningUpkeep(st, ev);

  ev.goldAfter = [st.gold[0], st.gold[1]];

  const leftGone = hqOf(st, 0) === null;
  const rightGone = hqOf(st, 1) === null;
  if (leftGone || rightGone) {
    const { winner, reason } = computeFinalResult(st);
    st.result = { winner, reason };
  } else if (st.day >= MAX_DAYS) {
    const { winner, reason } = computeFinalResult(st);
    st.result = { winner, reason };
  }

  return { state: st, events: ev };
}
