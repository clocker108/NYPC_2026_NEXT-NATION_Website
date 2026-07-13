// 브라우저 E2E 수동 검증 — 기본(Pyodide) 봇 백엔드 전체 플로우.
// 사용: dev 서버 켠 상태에서 `node scripts/e2e-wasmbot-browser.mjs` (playwright devDep 필요).

import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // 타이틀 인트로
await page.getByLabel("클릭하여 시작").click(); // 시작 게이트 (자동재생 unlock)
await page.waitForTimeout(2000); // 메뉴 슬라이드인
await page.getByText("인공지능 대전", { exact: true }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "시작" }).click();
await page.getByText("PLAYER A", { exact: true }).waitFor({ timeout: 90000 });
logs.push("게임 진입 OK — VS 인트로 종료 대기");
await page.waitForTimeout(3500);
// 빈 계획 제출 → Pyodide 봇 턴 응답 → 해소되면 TURN이 1이 된다
await page.getByRole("button", { name: /제출/ }).click();
try {
  await page.waitForFunction(
    () => document.body.innerText.includes("TURN\n1") || /TURN\s*\n?\s*1/.test(document.body.innerText),
    { timeout: 60000 },
  );
  logs.push("✅ 1턴 해소 완료 — 브라우저 Pyodide 봇 턴 교환 성공");
} catch {
  logs.push("❌ 턴 해소 실패");
  logs.push(await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, " | ")));
}
console.log(logs.join("\n"));
await browser.close();
