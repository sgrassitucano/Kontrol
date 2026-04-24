import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { AppModuleKey } from "@/lib/modules";

export async function requireUser() {
  const supabase = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, error: "Non autenticato." };
  }
  return { ok: true as const, supabase, userId: user.id };
}

export async function requireModuleAccess(module: AppModuleKey, requireWrite: boolean) {
  const base = await requireUser();
  if (!base.ok) return base;

  const { data, error } = await base.supabase.rpc("has_module_access", {
    target_module: module,
    require_write: requireWrite,
  });
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "Permessi insufficienti." };
  return base;
}

export async function requireAnyModuleAccess(modules: AppModuleKey[], requireWrite: boolean) {
  const base = await requireUser();
  if (!base.ok) return base;

  for (const moduleKey of modules) {
    const { data, error } = await base.supabase.rpc("has_module_access", {
      target_module: moduleKey,
      require_write: requireWrite,
    });
    if (error) return { ok: false as const, status: 500, error: error.message };
    if (data) return base;
  }
  return { ok: false as const, status: 403, error: "Permessi insufficienti." };
}

export async function requireAnyOperationalAccess() {
  const base = await requireUser();
  if (!base.ok) return base;

  const { data, error } = await base.supabase.rpc("has_any_operational_access");
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "Permessi insufficienti." };
  return base;
}
