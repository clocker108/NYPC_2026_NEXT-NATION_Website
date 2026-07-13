// JS AI 인터페이스 — 순수·결정론(시드 rng 주입). 출력은 항상 checkPlan으로 방어됨.

import type { MapData } from "@/engine/map";
import type { Command, GameState, Side } from "@/engine/types";

export interface BotDriver {
  id: string;
  nameKo: string;
  descKo: string;
  getCommands(state: GameState, map: MapData, side: Side, rng: () => number): Command[];
}
