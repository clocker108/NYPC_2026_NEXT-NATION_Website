// 브라우저 E2E — 인터넷 대전 전체 플로우 (두 브라우저 컨텍스트).
// 사용: next dev(:3000) + `npm run worker:dev`(:8787) 켠 상태에서
//       `node scripts/e2e-online-browser.mjs`
// 검증: 방 생성 → 코드 표시 → 입장 → 양쪽 게임 진입 → 1턴 왕복 → 게스트 새로고침 재접속.

import { chromium } from "playwright";

const browser = await chromium.launch();
const logs = [];
const ok = (m) => logs.push(`✅ ${m}`);
const fail = (m) => logs.push(`❌ ${m}`);

const hostCtx = await browser.newContext();
const guestCtx = await browser.newContext();
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
for (const [name, page] of [["host", host], ["guest", guest]]) {
  page.on("pageerror", (e) => logs.push(`[${name} pageerror] ${e.message}`));
}

try {
  // ── 호스트: 방 만들기
  await host.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await host.waitForTimeout(2500); // 타이틀 인트로
  await host.getByLabel("클릭하여 시작").click(); // 시작 게이트
  await host.waitForTimeout(2000); // 메뉴 슬라이드인
  await host.getByText("인터넷 대전", { exact: true }).click();
  await host.getByPlaceholder("플레이어").fill("호스트");
  await host.getByRole("button", { name: "방 만들기" }).last().click();
  await host.getByText("기다리는 중", { exact: false }).waitFor({ timeout: 15000 });
  const code = (await host.locator("span.font-mono").first().innerText()).trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`방 번호 형식 오류: ${code}`);
  ok(`방 생성 — 코드 ${code}`);

  // ── 게스트: 입장
  await guest.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await guest.waitForTimeout(2500);
  await guest.getByLabel("클릭하여 시작").click();
  await guest.waitForTimeout(2000);
  await guest.getByText("인터넷 대전", { exact: true }).click();
  await guest.getByPlaceholder("플레이어").fill("게스트");
  await guest.getByRole("button", { name: "입장", exact: true }).first().click(); // 방식 토글
  await guest.getByPlaceholder("000000").fill(code);
  await guest.getByRole("button", { name: "입장", exact: true }).last().click(); // 제출 버튼

  // ── 양쪽 게임 진입 (VS 인트로)
  await Promise.all([
    host.getByText("PLAYER A", { exact: true }).waitFor({ timeout: 20000 }),
    guest.getByText("PLAYER A", { exact: true }).waitFor({ timeout: 20000 }),
  ]);
  ok("양쪽 게임 진입 (VS 인트로)");
  await host.waitForTimeout(3500); // 인트로 종료

  // ── 1턴 왕복: 양쪽 제출 → TURN 1
  const turnIs = (n) => (body) => new RegExp(`TURN\\s*\\n?\\s*${n}(\\n|\\s|$)`).test(body);
  await host.getByRole("button", { name: /제출/ }).click();
  await guest.getByRole("button", { name: /제출/ }).click();
  await Promise.all([
    host.waitForFunction((fn) => new RegExp(`TURN\\s*\\n?\\s*1(\\n|\\s|$)`).test(document.body.innerText), null, { timeout: 20000 }),
    guest.waitForFunction(() => new RegExp(`TURN\\s*\\n?\\s*1(\\n|\\s|$)`).test(document.body.innerText), null, { timeout: 20000 }),
  ]);
  void turnIs;
  ok("1턴 해소 — 양쪽 TURN 1 도달");

  // ── 게스트 새로고침 → 재접속 복구
  await guest.reload({ waitUntil: "networkidle" });
  await guest.waitForTimeout(2500); // 인트로
  await guest.getByLabel("클릭하여 시작").click(); // 게이트 통과 후에야 재접속 안내가 뜬다
  await guest.waitForTimeout(2000);
  await guest.getByText("진행 중인 인터넷 대전이 있습니다", { exact: false }).waitFor({ timeout: 15000 });
  await guest.getByRole("button", { name: "재접속" }).click();
  await guest.waitForFunction(() => new RegExp(`TURN\\s*\\n?\\s*1(\\n|\\s|$)`).test(document.body.innerText), null, {
    timeout: 20000,
  });
  ok("게스트 새로고침 → 재접속 복구 (TURN 1 상태 재현)");

  // 호스트가 상대 복귀를 인지하는지 (peer_up으로 배너 사라짐 — 배너 부재 확인)
  await host.waitForTimeout(1500);
  const hostBanner = await host.evaluate(() => document.body.innerText.includes("상대 연결 끊김"));
  if (hostBanner) fail("호스트에 '상대 연결 끊김' 배너가 남아 있음");
  else ok("호스트 시점 상대 재접속 정상");
} catch (e) {
  fail(String(e && e.message ? e.message : e));
} finally {
  console.log(logs.join("\n"));
  await browser.close();
}
