"use client";

// 헤드리스 사운드 컨트롤러 — 화면(menu/game)에 따라 BGM을 전환하고,
// 문서 전역 위임 리스너 하나로 모든 버튼 클릭음을 처리한다(개별 onClick 산재 방지).
// 맵 폴리곤은 드래그 가드 때문에 MapView.cellClick에서 명시적으로 울린다.

import { useEffect } from "react";
import { useGameStore } from "@/store/gameStore";
import { soundManager } from "@/audio/soundManager";
import type { SfxId } from "@/audio/sounds";

export default function SoundManager() {
  const screen = useGameStore((s) => s.screen);

  useEffect(() => {
    soundManager.init();
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.("button");
      if (btn && !btn.hasAttribute("data-no-sfx"))
        // 기본은 깔끔한 게임 클릭음. 도톰한 팝(menu-click)은 주요 버튼만 data-sfx로 명시
        // (시작 화면 메뉴 행·게임 시작/방 만들기 버튼·명령 제출 등).
        soundManager.play((btn.getAttribute("data-sfx") as SfxId | null) ?? "ui-click");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    soundManager.setScreenTrack(screen === "menu" ? "menu" : "game");
  }, [screen]);

  return null;
}
