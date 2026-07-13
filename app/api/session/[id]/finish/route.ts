import { NextResponse } from "next/server";
import { finishSession, killSession } from "@/server/botSession";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({ resultLines: [] }))) as { resultLines?: string[] };
    return NextResponse.json(finishSession(id, body.resultLines ?? []));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(killSession(id));
}
