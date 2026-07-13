import { NextResponse } from "next/server";
import { exchangeTurn } from "@/server/botSession";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { day: number; resultLines: string[] };
    const result = await exchangeTurn(id, body.day, body.resultLines ?? []);
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
