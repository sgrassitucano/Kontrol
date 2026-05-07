import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { AppModuleKey } from "@/lib/modules";

export async function getCurrentUserContext(supabase: Awaited<ReturnType<typeof createSupabaseRouteHandlerClient>>) {
  const [{ data: role, error: roleError }, { data: isActive, error: isActiveError }] = await Promise.all([
    supabase.rpc("current_user_role"),
    supabase.rpc("current_user_is_active"),
  ]);
  if (roleError) throw new Error(roleError.message);
  if (isActiveError) throw new Error(isActiveError.message);
  return {
    role: (role ?? "manager") as "admin" | "viewer" | "manager",
    isActive: Boolean(isActive),
  };
}

export async function requireUser() {
  const supabase = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, error: "Non autenticato." };
  }
  const { data: isActive, error: isActiveError } = await supabase.rpc("current_user_is_active");
  if (isActiveError) {
    return { ok: false as const, status: 500, error: isActiveError.message };
  }
  if (!isActive) {
    return { ok: false as const, status: 403, error: "Utente disattivato." };
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
