import { NextResponse } from "next/server";
import { createSession, type MapPayload } from "@/server/botSession";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { botId: string; side: "LEFT" | "RIGHT"; map: MapPayload };
    const result = await createSession(body.botId, body.side, body.map);
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
