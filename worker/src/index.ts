// 인터넷 대전 워커 — /ws 라우팅 + 방 번호 할당.
// 호스트: 랜덤 6자리 코드를 뽑아 해당 DO에 claim → 성공하면 업그레이드를 그 DO로 전달.
// 입장/재접속: 코드로 DO를 직접 찾아 전달.

import { isValidCode } from "../../src/online/protocol";
export { RoomDO } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace;
}

function randomCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      // 헬스체크 — 클라이언트(COEP: require-corp 페이지)의 서버 생존 프로브가 읽을 수 있도록
      // CORS + CORP 헤더를 준다 (없으면 브라우저가 응답을 차단해 "서버 없음"으로 오탐).
      return new Response("nextnation-online ok", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }
    if (url.pathname !== "/ws") {
      return new Response("not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const role = url.searchParams.get("role");

    if (role === "host") {
      // 빈 방 코드 확보 (충돌 시 재시도)
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const claim = await stub.fetch(`https://do/claim?code=${code}`, { method: "POST" });
        if (claim.status === 200) {
          const fwd = new URL(request.url);
          fwd.searchParams.set("code", code);
          return stub.fetch(new Request(fwd.toString(), request));
        }
      }
      return new Response("no room available", { status: 503 });
    }

    if (role === "join" || role === "rejoin") {
      const code = url.searchParams.get("code");
      if (!isValidCode(code)) return new Response("bad code", { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return new Response("bad role", { status: 400 });
  },
};
