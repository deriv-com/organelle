import { NextResponse } from "next/server";

/** Public liveness endpoint. It intentionally does not expose configuration or data. */
export function GET() {
  return NextResponse.json({ ok: true });
}
