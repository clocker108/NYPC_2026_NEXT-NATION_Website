// Cloudflare Pages용 정적 빌드 (npm run build:static → out/)
// API Routes(서버 봇 브리지)는 `output: export`와 공존할 수 없어 빌드 동안만
// app/api를 치워둔다 — 배포판에서는 브라우저 Pyodide 백엔드가 봇을 대신 돌린다.

import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const API = fileURLToPath(new URL("../app/api", import.meta.url));
const ASIDE = fileURLToPath(new URL("../app/_api-excluded", import.meta.url));

if (existsSync(ASIDE)) {
  console.error("app/_api-excluded 가 이미 존재합니다 — 이전 빌드가 비정상 종료된 듯. 수동으로 복구하세요.");
  process.exit(1);
}

const hadApi = existsSync(API);
if (hadApi) await rename(API, ASIDE);
let code = 1;
try {
  code =
    spawnSync("npx", ["next", "build"], {
      stdio: "inherit",
      env: { ...process.env, STATIC_EXPORT: "1", NEXT_TELEMETRY_DISABLED: "1" },
    }).status ?? 1;
} finally {
  if (hadApi) await rename(ASIDE, API);
}
process.exit(code);
