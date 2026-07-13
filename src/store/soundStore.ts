// 사운드 설정 (BGM/효과음 ON·OFF) — 게임 전용 ViewOptions와 달리 메뉴에서도 쓰는 전역 설정이라
// 별도 스토어 + localStorage 지속. 실제 재생 반영은 soundManager가 subscribe로 처리한다.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SoundStore {
  bgmOn: boolean;
  sfxOn: boolean;
  toggleBgm: () => void;
  toggleSfx: () => void;
}

export const useSoundStore = create<SoundStore>()(
  persist(
    (set) => ({
      bgmOn: true,
      sfxOn: true,
      toggleBgm: () => set((s) => ({ bgmOn: !s.bgmOn })),
      toggleSfx: () => set((s) => ({ sfxOn: !s.sfxOn })),
    }),
    { name: "nn:sound", storage: createJSONStorage(() => localStorage) },
  ),
);
