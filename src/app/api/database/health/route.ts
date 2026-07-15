import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthCheckRow = {
  database: string;
  checkedAt: string;
};

export async function GET() {
  try {
    const result = await queryDatabase<HealthCheckRow>(
      `select current_database() as database, now()::text as "checkedAt"`,
    );
    const health = result.rows[0];

    return NextResponse.json({
      ok: true,
      database: health?.database ?? null,
      checkedAt: health?.checkedAt ?? null,
    });
  } catch (error) {
    console.error("PostgreSQL health check failed.", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Database connection failed.",
      },
      { status: 503 },
    );
  }
}
