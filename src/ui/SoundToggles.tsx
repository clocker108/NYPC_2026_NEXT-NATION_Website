"use client";

// 사운드 텍스트 토글 (BGM / 효과음) — 메뉴 우하단, 모드 전환 링크 왼쪽에 글자로만.
// ON = 밝게, OFF = 살짝 어둡게. localStorage 지속(soundStore).
// 저장값과 SSR 기본값이 다를 수 있어 마운트 후에만 렌더한다(hydration 불일치 방지).

import { useEffect, useState } from "react";
import { useSoundStore } from "@/store/soundStore";
import { soundManager } from "@/audio/soundManager";

function TextToggle({ on, label, noSfx, onClick }: { on: boolean; label: string; noSfx?: boolean; onClick: () => void }) {
  return (
    <button
      data-no-sfx={noSfx ? "" : undefined}
      className={`cursor-pointer text-xs transition ${on ? "text-white/90 hover:text-white" : "text-chromedim/60 hover:text-chromedim"}`}
      title={`${label} ${on ? "끄기" : "켜기"}`}
      onClick={onClick}
    >
      {label} {on ? "ON" : "OFF"}
    </button>
  );
}

export default function SoundToggles() {
  const bgmOn = useSoundStore((s) => s.bgmOn);
  const sfxOn = useSoundStore((s) => s.sfxOn);
  const toggleBgm = useSoundStore((s) => s.toggleBgm);
  const toggleSfx = useSoundStore((s) => s.toggleSfx);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <>
      <TextToggle on={bgmOn} label="BGM" onClick={toggleBgm} />
      <TextToggle
        on={sfxOn}
        label="효과음"
        noSfx // 공용 클릭음 대신 직접 처리 — 끄는 클릭은 무음, 켜는 클릭은 확인음
        onClick={() => {
          toggleSfx();
          if (!sfxOn) soundManager.play("ui-click"); // 토글은 주요 버튼이 아니므로 기본 클릭음
        }}
      />
    </>
  );
}
