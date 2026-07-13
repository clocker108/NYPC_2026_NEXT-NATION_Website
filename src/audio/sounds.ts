// 사운드 카탈로그 + 순수 로직 — 재생 계층(soundManager)과 분리해 노드 vitest로 테스트한다.

export type SfxId =
  | "ui-hover" // 메뉴 행 hover 틱
  | "ui-click" // 게임 화면 버튼 클릭 (깔끔한 클릭)
  | "menu-click" // 시작 화면 버튼 클릭 (도톰한 팝 — 더 크게)
  | "map-click" // 맵 구역 클릭 (타격감)
  | "game-start" // 게임 시작 (VS 인트로)
  | "build" // 기지 건설
  | "upgrade" // 기지/본부 업그레이드·수리
  | "destroy" // 기지/본부 파괴
  | "move" // 전사 이동
  | "combat" // 전사 전투
  | "game-end" // 게임 종료
  | "warn-time"; // 턴 잔여시간 경고

export type BgmTrack = "menu" | "game" | "wait";

export const SFX_FILES: Record<SfxId, string> = {
  "ui-hover": "/sounds/ui-hover.mp3",
  "ui-click": "/sounds/ui-click.mp3",
  "menu-click": "/sounds/menu-click.mp3",
  "map-click": "/sounds/map-click.mp3",
  "game-start": "/sounds/game-start.mp3",
  build: "/sounds/build.mp3",
  upgrade: "/sounds/upgrade.mp3",
  destroy: "/sounds/destroy.mp3",
  move: "/sounds/move.mp3",
  combat: "/sounds/combat.mp3",
  "game-end": "/sounds/game-end.mp3",
  "warn-time": "/sounds/warn-time.mp3",
};

export const BGM_FILES: Record<BgmTrack, string> = {
  menu: "/sounds/bgm-menu.mp3",
  game: "/sounds/bgm-game.mp3",
  wait: "/sounds/bgm-wait.mp3",
};

export const BGM_GAIN = 0.35;
export const SFX_GAIN = 0.5;
/** 동일 SFX 최소 재생 간격 — 배속 연출에서 같은 소리가 다다닥 겹치는 왜곡 방지 */
export const SFX_MIN_GAP_MS = 80;

/**
 * 지금 흘러야 할 BGM 트랙 — 대기실 루프가 화면 트랙보다 우선, BGM 꺼짐이면 없음.
 * gameOver(승패 확정)면 게임 화면에서도 메뉴 곡으로 돌아간다.
 */
export function effectiveBgmTrack(
  screenTrack: "menu" | "game",
  waitLoopOn: boolean,
  bgmOn: boolean,
  gameOver = false,
): BgmTrack | null {
  if (!bgmOn) return null;
  if (waitLoopOn) return "wait";
  return screenTrack === "game" && gameOver ? "menu" : screenTrack;
}

/** 동일 id 디듀프 — 마지막 재생 시각 기준 최소 간격을 지켰는지 */
export function shouldPlaySfx(lastAt: number | undefined, now: number, minGapMs = SFX_MIN_GAP_MS): boolean {
  return lastAt === undefined || now - lastAt >= minGapMs;
}

/**
 * 카운트다운 경고음을 울릴 초 — remain(올림 초)이 1~10이고 아직 안 울린 초면 그 값을,
 * 아니면 null. (500ms 인터벌이 같은 초를 두 번 보므로 lastWarned로 중복 차단)
 */
export function warnSecond(remain: number, lastWarned: number | null): number | null {
  if (remain < 1 || remain > 10) return null;
  if (lastWarned !== null && remain >= lastWarned) return null;
  return remain;
}
