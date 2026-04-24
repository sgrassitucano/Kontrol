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
  const { data, error } = await supabase.rpc("has_any_operational_access");
  if (error) throw new Error(error.message);
  if (!data) redirect("/no-access");
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
