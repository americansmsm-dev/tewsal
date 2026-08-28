/**
 * فحص صحة النظام — بيستخدمه Docker healthcheck و Coolify.
 * بيتأكد إن قاعدة البيانات بترد.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", db: "up", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
