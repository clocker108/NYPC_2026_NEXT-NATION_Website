import type { NextConfig } from "next";

// STATIC_EXPORT=1 → Cloudflare Pages용 정적 빌드 (API Routes는 빌드 스크립트가 치워둠).
// 이때 봇 브리지는 브라우저-내 Pyodide 백엔드가 대신한다.
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pyodide 봇 워커의 SharedArrayBuffer에는 cross-origin isolation이 필요.
  // - 정적 export(배포): headers()가 무시되므로 public/_headers가 담당 → 여기선 정의 안 함(export 경고 방지).
  // - dev(비-static): 로컬에서도 COOP/COEP가 있어야 Pyodide가 되므로 headers()로 주입.
  ...(isStatic
    ? { output: "export" as const }
    : {
        headers: async () => [
          {
            source: "/:path*",
            headers: [
              { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
              { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
            ],
          },
        ],
      }),
};

export default nextConfig;
