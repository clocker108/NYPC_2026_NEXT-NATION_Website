// 핵심 타입 — testing-tool.py의 상태 모델을 그대로 반영.

export type Side = 0 | 1; // 0 = LEFT(A), 1 = RIGHT(B)

export const LEFT: Side = 0;
export const RIGHT: Side = 1;

export function sideLetter(s: Side): "A" | "B" {
  return s === 0 ? "A" : "B";
}

export function sideName(s: Side): "LEFT" | "RIGHT" {
  return s === 0 ? "LEFT" : "RIGHT";
}

// 전사 키: LEFT = -suffix, RIGHT = +suffix (엔진의 wkey와 동일)
export type WKey = number;

export function wkey(side: Side, suffix: number): WKey {
  return side === 0 ? -suffix : suffix;
}

export function sideFromKey(key: WKey): Side {
  return key < 0 ? 0 : 1;
}

export function suffixFromKey(key: WKey): number {
  return key < 0 ? -key : key;
}

export function idStr(key: WKey): string {
  return sideLetter(sideFromKey(key)) + suffixFromKey(key);
}

// 정렬 기준 (side 오름차순 → suffix 오름차순) — _merge_results와 동일
export function wkeyCompare(a: WKey, b: WKey): number {
  const sa = sideFromKey(a), sb = sideFromKey(b);
  if (sa !== sb) return sa - sb;
  return suffixFromKey(a) - suffixFromKey(b);
}

export type BKind = "HQ" | "BASE";

export interface Warrior {
  key: WKey;
  side: Side;
  suffix: number;
  region: number;
  hp: number;
  movingTarget: number | null;
}

export interface Building {
  region: number;
  side: Side;
  kind: BKind;
  level: number;
  hp: number;
}

export type ResultReason = "HQ_DESTROYED" | "TURN_LIMIT" | "WA";
export type Winner = "LEFT_WIN" | "RIGHT_WIN" | "DRAW";

export interface GameResult {
  winner: Winner;
  reason: ResultReason;
}

export interface GameState {
  day: number;
  gold: [number, number];
  warriors: Map<WKey, Warrior>; // 삽입 순서 유지 (Python dict과 동일)
  buildings: Map<number, Building>;
  nextSuffix: [number, number];
  result: GameResult | null;
}

// 구조화된 명령 (UI/AI용). 리플레이·봇은 원시 라인으로도 주고받는다.
export type Command =
  | { type: "MOVE"; suffix: number; region: number }
  | { type: "TRAIN"; n: number }
  | { type: "UPGRADE"; region: number };

export function commandToLine(side: Side, cmd: Command): string {
  switch (cmd.type) {
    case "MOVE":
      return `MOVE ${sideLetter(side)}${cmd.suffix} ${cmd.region}`;
    case "TRAIN":
      return `TRAIN ${cmd.n}`;
    case "UPGRADE":
      return `UPGRADE ${cmd.region}`;
  }
}

export function commandsToLines(side: Side, cmds: Command[]): string[] {
  return cmds.map((c) => commandToLine(side, c));
}
