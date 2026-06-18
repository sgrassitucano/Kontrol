import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppModuleKey } from "@/lib/modules";

export async function requireAuthenticatedPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function requireAnyOperationalPageAccess() {
  const { supabase, user } = await requireAuthenticatedPage();
  const [{ data: hasOperational, error: opError }, { data: hasGestione, error: gestioneError }] = await Promise.all([
    supabase.rpc("has_any_operational_access"),
    supabase.rpc("has_module_access", {
      target_module: "gestione",
      require_write: false,
    }),
  ]);
  if (opError) throw new Error(opError.message);
  if (gestioneError) throw new Error(gestioneError.message);
  if (!hasOperational && !hasGestione) redirect("/no-access");
  return { supabase, user };
}

export async function requirePageModuleAccess(moduleKey: AppModuleKey) {
  const { supabase, user } = await requireAuthenticatedPage();
  const { data, error } = await supabase.rpc("has_module_access", {
    target_module: moduleKey,
    require_write: false,
  });
  if (error) throw new Error(error.message);
  if (!data) redirect("/no-access");
  return { supabase, user };
}
