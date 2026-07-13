// 이벤트 → 로그 라인 / 봇 프로토콜 블록 직렬화.
// testing-tool.py의 _merge_results + write_turn_result / send_result_block 포팅.
// 모든 항목을 결정론적으로 재정렬하므로 내부 순서가 출력에 새지 않는다.

import type { DamageCause, TurnEvents } from "./events";
import type { Side } from "./types";
import { idStr, sideLetter, wkeyCompare } from "./types";

const CAUSE_ORDER: Record<DamageCause, number> = { TURRET: 0, COMBAT: 1, HUNGER: 2 };

interface Merged {
  trained: number[]; // keys, (side,suffix) 정렬
  upgrades: { region: number; side: Side }[]; // region 정렬
  moves: { key: number; to: number }[]; // (side,suffix) 정렬
  damages: { cause: DamageCause; key: number; amount: number }[]; // (cause,side,suffix) 정렬
  sieges: { side: Side; region: number; dealt: number }[]; // region 정렬
}

export function mergeEvents(ev: TurnEvents): Merged {
  return {
    trained: ev.trained.map((t) => t.key).sort(wkeyCompare),
    upgrades: [...ev.upgrades].sort((a, b) => a.region - b.region),
    moves: ev.moves.map((mv) => ({ key: mv.key, to: mv.to })).sort((a, b) => wkeyCompare(a.key, b.key)),
    damages: [...ev.damages]
      .map((d) => ({ cause: d.cause, key: d.key, amount: d.amount }))
      .sort((a, b) => CAUSE_ORDER[a.cause] - CAUSE_ORDER[b.cause] || wkeyCompare(a.key, b.key)),
    sieges: ev.sieges.map((s) => ({ side: s.side, region: s.region, dealt: s.dealt })).sort((a, b) => a.region - b.region),
  };
}

/** 로그 파일 형식의 턴 결과 라인들 (TIME 제외 — 재현 불가능한 값이므로 diff에서도 제외). */
export function eventsToLogLines(ev: TurnEvents): string[] {
  const m = mergeEvents(ev);
  const out: string[] = [];
  for (const u of m.upgrades) out.push(`UPGRADE ${sideLetter(u.side)} ${u.region}`);
  if (m.trained.length > 0) out.push("TRAIN " + m.trained.map(idStr).join(" "));
  for (const mv of m.moves) out.push(`MOVE ${idStr(mv.key)} ${mv.to}`);
  for (const d of m.damages) out.push(`DAMAGE ${d.cause} ${idStr(d.key)} ${d.amount}`);
  for (const s of m.sieges) out.push(`SIEGE ${sideLetter(s.side)} ${s.region} ${s.dealt}`);
  return out;
}

/**
 * 봇 프로토콜용 결과 블록 (send_result_block 포팅) — 개수 헤더 항상 포함.
 * 내용은 양측 동일(병합본), TIME의 self/opp만 바뀐다.
 */
export function botResultBlock(
  ev: TurnEvents,
  selfMs: number,
  selfTokens: number,
  oppMs: number,
  oppTokens: number,
): string[] {
  const m = mergeEvents(ev);
  const out: string[] = [];
  out.push(`TURN ${ev.day}`);
  out.push(`TIME ${selfMs} ${selfTokens} ${oppMs} ${oppTokens}`);
  out.push(`UPGRADE ${m.upgrades.length}`);
  for (const u of m.upgrades) out.push(`${sideLetter(u.side)} ${u.region}`);
  out.push(`TRAIN ${m.trained.length}`);
  if (m.trained.length > 0) out.push(m.trained.map(idStr).join(" "));
  out.push(`MOVE ${m.moves.length}`);
  for (const mv of m.moves) out.push(`${idStr(mv.key)} ${mv.to}`);
  out.push(`DAMAGE ${m.damages.length}`);
  for (const d of m.damages) out.push(`${d.cause} ${idStr(d.key)} ${d.amount}`);
  out.push(`SIEGE ${m.sieges.length}`);
  for (const s of m.sieges) out.push(`${sideLetter(s.side)} ${s.region} ${s.dealt}`);
  out.push("END");
  return out;
}
