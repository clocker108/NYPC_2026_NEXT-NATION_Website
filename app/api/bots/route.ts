import { NextResponse } from "next/server";
import { BRIDGE_BOTS } from "@/server/bots";

export function GET() {
  return NextResponse.json({
    bots: BRIDGE_BOTS.filter((b) => !b.hidden).map(({ id, nameKo }) => ({ id, nameKo })),
  });
}
