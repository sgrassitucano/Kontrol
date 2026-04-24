import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/access";
import type { AppModuleKey } from "@/lib/modules";

export const runtime = "nodejs";

const moduleKeys: AppModuleKey[] = [
  "lavoratori",
  "formazione",
  "sorveglianza",
  "dpi",
  "mezzi_attrezzature",
  "turni",
  "gestione",
];

type ProfileRow = {
  email: string;
  full_name: string | null;
  role: "admin" | "viewer" | "manager";
  manager_code: string | null;
  is_active: boolean;
};

export async function GET() {
  const base = await requireUser();
  if (!base.ok) return NextResponse.json({ error: base.error }, { status: base.status });

  const {
    data: { user },
  } = await base.supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato." }, { status: 401 });

  const { data: profileData, error: profileError } = await base.supabase
    .from("profiles")
    .select("email,full_name,role,manager_code,is_active")
    .eq("id", base.userId)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const profile = (profileData ?? {
    email: user.email ?? "",
    full_name: null,
    role: "manager",
    manager_code: null,
    is_active: false,
  }) as ProfileRow;

  const entries = await Promise.all(
    moduleKeys.map(async (moduleKey) => {
      const { data: canRead, error: readError } = await base.supabase.rpc("has_module_access", {
        target_module: moduleKey,
        require_write: false,
      });
      if (readError) throw new Error(readError.message);
      const { data: canWrite, error: writeError } = await base.supabase.rpc("has_module_access", {
        target_module: moduleKey,
        require_write: true,
      });
      if (writeError) throw new Error(writeError.message);
      return [moduleKey, { canRead: Boolean(canRead), canWrite: Boolean(canWrite) }] as const;
    }),
  ).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Errore permessi.";
    return NextResponse.json({ error: message }, { status: 500 });
  });

  if (entries instanceof NextResponse) return entries;

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile,
    modules: Object.fromEntries(entries),
  });
}
