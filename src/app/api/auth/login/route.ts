import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let payload: LoginPayload;
  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json({ error: "Payload non valido." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Credenziali mancanti." }, { status: 400 });
  }

  const supabase = await createSupabaseRouteHandlerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return NextResponse.json({ error: "Credenziali non valide." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Errore verifica profilo." }, { status: 500 });
  }
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Utente disattivato." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, user: { id: data.user.id, email: data.user.email } });
}
