// 브리지 봇 레지스트리 — 실행 파일은 전부 website/server-bots/ 복사본 (자기완결).

import path from "node:path";

export interface BridgeBot {
  id: string;
  nameKo: string;
  file: string;
  hidden?: boolean; // 선택 목록에서 제외 (테스트 전용 — 세션 생성은 여전히 가능)
}

export const BRIDGE_BOTS: BridgeBot[] = [
  { id: "latest", nameKo: "Lv.2080", file: "latest.py" },
  { id: "68637", nameKo: "Lv.1805", file: "68637.py" },
  { id: "sample", nameKo: "플랫폼 샘플 봇", file: "sample-code.py", hidden: true },
];

export function botById(id: string): BridgeBot | undefined {
  return BRIDGE_BOTS.find((b) => b.id === id);
}

export function botsDir(): string {
  return path.join(process.cwd(), "server-bots");
}
