// 사운드 순수 로직 + 설정 스토어 (재생 계층은 브라우저 E2E에서 검증)

import { beforeAll, describe, expect, it } from "vitest";
import { effectiveBgmTrack, shouldPlaySfx, warnSecond, SFX_FILES, BGM_FILES } from "@/audio/sounds";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("사운드 순수 로직", () => {
  it("effectiveBgmTrack: BGM 꺼짐 → 없음, 대기 루프가 화면 트랙보다 우선", () => {
    expect(effectiveBgmTrack("menu", false, false)).toBe(null);
    expect(effectiveBgmTrack("game", true, false)).toBe(null);
    expect(effectiveBgmTrack("menu", false, true)).toBe("menu");
    expect(effectiveBgmTrack("game", false, true)).toBe("game");
    expect(effectiveBgmTrack("menu", true, true)).toBe("wait");
    expect(effectiveBgmTrack("game", true, true)).toBe("wait");
  });

  it("effectiveBgmTrack: 승패 확정(gameOver)이면 게임 화면에서도 메뉴 곡", () => {
    expect(effectiveBgmTrack("game", false, true, true)).toBe("menu");
    expect(effectiveBgmTrack("game", false, true, false)).toBe("game");
    expect(effectiveBgmTrack("menu", false, true, true)).toBe("menu"); // 메뉴에선 영향 없음
    expect(effectiveBgmTrack("game", false, false, true)).toBe(null); // BGM 꺼짐이 우선
    expect(effectiveBgmTrack("game", true, true, true)).toBe("wait"); // 대기 루프가 우선 (실제로는 공존 안 함)
  });

  it("shouldPlaySfx: 최소 간격 내 중복 차단", () => {
    expect(shouldPlaySfx(undefined, 1000)).toBe(true);
    expect(shouldPlaySfx(1000, 1050)).toBe(false); // 50ms < 80ms
    expect(shouldPlaySfx(1000, 1080)).toBe(true);
    expect(shouldPlaySfx(1000, 1200, 300)).toBe(false); // 커스텀 간격
  });

  it("warnSecond: 1~10초에서 초당 1회만", () => {
    expect(warnSecond(11, null)).toBe(null); // 아직 경고 구간 아님
    expect(warnSecond(10, null)).toBe(10); // 첫 경고
    expect(warnSecond(10, 10)).toBe(null); // 같은 초 중복 차단 (500ms 틱)
    expect(warnSecond(9, 10)).toBe(9);
    expect(warnSecond(7, 10)).toBe(7); // 랙으로 초를 건너뛰어도 울림
    expect(warnSecond(0, 5)).toBe(null); // 만료 후엔 무음
  });

  it("카탈로그의 모든 파일이 public/sounds/에 실재한다", () => {
    const pub = join(__dirname, "..", "public");
    for (const f of [...Object.values(SFX_FILES), ...Object.values(BGM_FILES)]) {
      expect(existsSync(join(pub, f)), `${f} 누락`).toBe(true);
    }
  });
});

describe("사운드 설정 스토어 (localStorage 지속)", () => {
  beforeAll(() => {
    const mem = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    } as Storage;
  });

  it("토글이 상태와 localStorage에 반영된다", async () => {
    const { useSoundStore } = await import("@/store/soundStore");
    expect(useSoundStore.getState().bgmOn).toBe(true);
    expect(useSoundStore.getState().sfxOn).toBe(true);

    useSoundStore.getState().toggleBgm();
    expect(useSoundStore.getState().bgmOn).toBe(false);
    useSoundStore.getState().toggleSfx();
    expect(useSoundStore.getState().sfxOn).toBe(false);

    const saved = JSON.parse(globalThis.localStorage.getItem("nn:sound")!);
    expect(saved.state).toMatchObject({ bgmOn: false, sfxOn: false });
  });
});
