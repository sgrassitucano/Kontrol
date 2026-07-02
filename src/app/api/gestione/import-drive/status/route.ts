import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("gestione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let configured = false;
  let serviceAccountEmail: string | null = null;
  if (raw) {
    try {
      const creds = JSON.parse(raw) as { client_email?: string };
      configured = Boolean(creds.client_email);
      serviceAccountEmail = creds.client_email ?? null;
    } catch {
      configured = false;
    }
  }

  return NextResponse.json({ configured, serviceAccountEmail });
}
