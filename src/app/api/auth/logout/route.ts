import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: "Logout non riuscito." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
