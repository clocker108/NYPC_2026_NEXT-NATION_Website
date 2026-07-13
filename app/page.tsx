"use client";

import { useGameStore } from "@/store/gameStore";
import ModeSelect from "@/ui/screens/ModeSelect";
import GameScreen from "@/ui/screens/GameScreen";
import SoundManager from "@/ui/SoundManager";

export default function Home() {
  const screen = useGameStore((s) => s.screen);
  return (
    <>
      <SoundManager />
      {screen === "menu" ? <ModeSelect /> : <GameScreen />}
    </>
  );
}
