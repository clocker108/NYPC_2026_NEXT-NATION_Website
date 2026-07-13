// 게임 상수 — engine/testing-tool.py(정본)에서 그대로 포팅.

export const START_GOLD = 500;
export const START_WARRIORS = 3;
export const TRAIN_COST = 120;
export const MOVE_COST = 10;
export const BASE_BUILD_COST = 300;
export const WORK_INCOME = 15;
export const UPKEEP_PER = 2;
export const MAX_DAYS = 200;

export const HQ_MAX_LEVEL = 5;
export const BASE_MAX_LEVEL = 3;
export const HQ_HEAL_COST = 1000;
export const BASE_HEAL_COST = 500;

export interface HqLevelEntry {
  upgradeCost: number;
  warriorHp: number;
  hp: number;
  turret: number;
  trainCap: number;
  workCap: number;
}

export interface BaseLevelEntry {
  cost: number;
  hp: number;
  turret: number;
  workCap: number;
}

// 인덱스 = 레벨 (0은 센티널)
export const HQ_LEVELS: readonly HqLevelEntry[] = [
  { upgradeCost: 0, warriorHp: 0, hp: 0, turret: 0, trainCap: 0, workCap: 0 },
  { upgradeCost: 0, warriorHp: 4, hp: 10, turret: 1, trainCap: 1, workCap: 1 },
  { upgradeCost: 600, warriorHp: 5, hp: 15, turret: 2, trainCap: 1, workCap: 2 },
  { upgradeCost: 1200, warriorHp: 6, hp: 20, turret: 2, trainCap: 2, workCap: 3 },
  { upgradeCost: 2400, warriorHp: 7, hp: 25, turret: 3, trainCap: 2, workCap: 4 },
  { upgradeCost: 3600, warriorHp: 8, hp: 30, turret: 3, trainCap: 3, workCap: 5 },
];

export const BASE_LEVELS: readonly BaseLevelEntry[] = [
  { cost: 0, hp: 0, turret: 0, workCap: 0 },
  { cost: 300, hp: 6, turret: 1, workCap: 1 },
  { cost: 600, hp: 12, turret: 1, workCap: 2 },
  { cost: 1000, hp: 18, turret: 2, workCap: 3 },
];

export function hqWarriorHp(level: number): number {
  return HQ_LEVELS[level].warriorHp;
}

// 맵 생성 상수
export const GEN_L = 10000;
export const GEN_D = 100;
export const GEN_A = 24;
