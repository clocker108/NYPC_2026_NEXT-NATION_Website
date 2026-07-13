import type { NextConfig } from "next";

// STATIC_EXPORT=1 → Cloudflare Pages용 정적 빌드 (API Routes는 빌드 스크립트가 치워둠).
// 이때 봇 브리지는 브라우저-내 Pyodide 백엔드가 대신한다.
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isStatic ? { output: "export" as const } : {}),
  // Pyodide 봇 워커의 SharedArrayBuffer에는 cross-origin isolation이 필요.
  // (정적 export에서는 headers()가 무시되므로 배포용은 public/_headers가 담당)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
