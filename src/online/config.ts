// 인터넷 대전 WS 엔드포인트 — 배포 시 Pages 빌드 env로 주입.
// 예: NEXT_PUBLIC_WS_URL=wss://nextnation-online.<account>.workers.dev

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787";
