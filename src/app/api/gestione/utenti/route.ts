import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

type AppModule = "lavoratori" | "formazione" | "sorveglianza" | "dpi" | "mezzi_attrezzature" | "turni" | "gestione";

type PermissionInput = { module: AppModule; level: "read" | "write" };

type UserRole = "admin" | "viewer" | "manager";

type ProfilesRow = {
  id: string;
  email: string;
  full_name: string | null;
  manager_code: string | null;
  role: UserRole;
  is_active: boolean;
};

type ModulePermissionRow = {
  user_id: string;
  module: AppModule;
  can_write: boolean;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeManagerCode(value: unknown) {
  const raw = String(value ?? "").trim().toUpperCase();
  return raw || null;
}

function normalizeRole(value: unknown): UserRole | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "admin") return "admin";
  if (raw === "viewer") return "viewer";
  if (raw === "manager") return "manager";
  return null;
}

function normalizeFullName(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function isAppModule(value: unknown): value is AppModule {
  return (
    value === "lavoratori" ||
    value === "formazione" ||
    value === "sorveglianza" ||
    value === "dpi" ||
    value === "mezzi_attrezzature" ||
    value === "turni" ||
    value === "gestione"
  );
}

async function requireGestioneWrite() {
  const supabaseServer = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Non autenticato." };

  const { data, error } = await supabaseServer.rpc("has_module_access", {
    target_module: "gestione",
    require_write: true,
  });
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "Permessi insufficienti." };
  return { ok: true as const, userId: user.id };
}

export const runtime = "nodejs";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const QUERY_CHUNK_SIZE = 500;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseOffsetParam(value: string | null) {
  if (!value) return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizeQuery(value: string | null) {
  const q = String(value ?? "").trim().toLowerCase();
  if (!q) return null;
  return q.slice(0, 100);
}

export async function GET(request: Request) {
  const auth = await requireGestioneWrite();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = createSupabaseAdminClient();

    const requestUrl = new URL(request.url);
    const query = normalizeQuery(requestUrl.searchParams.get("q"));
    const limit = parseLimitParam(requestUrl.searchParams.get("limit"), query ? 200 : DEFAULT_LIMIT);
    const offset = parseOffsetParam(requestUrl.searchParams.get("offset"));

    let profilesQuery = supabase
      .from("profiles")
      .select("id,email,full_name,manager_code,role,is_active")
      .order("email")
      .range(offset, offset + limit);
    if (query) {
      profilesQuery = profilesQuery.ilike("email", `%${query}%`);
    }

    const { data: profilesData, error: profilesError } = await profilesQuery;
    if (profilesError) throw new Error(profilesError.message);

    const profilesRaw = (profilesData ?? []) as ProfilesRow[];
    const truncated = profilesRaw.length > limit;
    const profiles = profilesRaw.slice(0, limit);

    const userIds = profiles.map((p) => p.id);
    const perms: ModulePermissionRow[] = [];
    for (let i = 0; i < userIds.length; i += QUERY_CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + QUERY_CHUNK_SIZE);
      const { data, error } = await supabase
        .from("module_permissions")
        .select("user_id,module,can_write")
        .in("user_id", chunk);
      if (error) throw new Error(error.message);
      perms.push(...((data ?? []) as ModulePermissionRow[]));
    }

    const permsByUser = new Map<string, ModulePermissionRow[]>();
    perms.forEach((row) => {
      const list = permsByUser.get(row.user_id);
      if (!list) permsByUser.set(row.user_id, [row]);
      else list.push(row);
    });

    const users = profiles.map((p) => {
      const userPerms = permsByUser.get(p.id) ?? [];
      const permissions =
        p.role === "manager"
          ? userPerms
              .filter((r) => isAppModule(r.module) && r.module !== "gestione")
              .map((r) => ({ module: r.module, level: r.can_write ? "write" : ("read" as const) }))
          : [];
      const role: UserRole = p.role;
      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name ?? "",
        managerCode: p.manager_code ?? "",
        isActive: p.is_active,
        role,
        permissions,
      };
    });

    return NextResponse.json({ limit, offset, truncated, users });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento utenti." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireGestioneWrite();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      email: string;
      password: string;
      fullName?: string;
      role?: UserRole;
      managerCode?: string;
      permissions?: PermissionInput[];
    };

    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "").trim();
    const fullName = normalizeFullName(body.fullName);
    const role = normalizeRole(body.role) ?? "manager";
    const managerCode = role === "manager" ? normalizeManagerCode(body.managerCode) : null;

    if (!email) return NextResponse.json({ error: "Email obbligatoria." }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Password obbligatoria." }, { status: 400 });
    if (role === "manager" && managerCode === null) {
      return NextResponse.json({ error: "Codice manager obbligatorio per ruolo Manager." }, { status: 400 });
    }

    const permissionsInput = Array.isArray(body.permissions) ? body.permissions : [];
    const normalizedPermissions = permissionsInput
      .filter((p) => p && isAppModule(p.module) && (p.level === "read" || p.level === "write"))
      .filter((p) => p.module !== "gestione")
      .map((p) => ({ module: p.module, can_write: p.level === "write" }));

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    const userId = data.user?.id;
    if (!userId) throw new Error("Creazione utente fallita (id mancante).");

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ full_name: fullName, manager_code: managerCode, role, is_active: true })
      .eq("id", userId);
    if (profileError) throw new Error(profileError.message);

    if (role === "manager" && normalizedPermissions.length > 0) {
      const { error: permsError } = await supabaseAdmin.from("module_permissions").upsert(
        normalizedPermissions.map((p) => ({
          user_id: userId,
          module: p.module,
          can_write: p.can_write,
        })),
        { onConflict: "user_id,module" },
      );
      if (permsError) throw new Error(permsError.message);
    }

    return NextResponse.json({ ok: true, id: userId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione utente." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireGestioneWrite();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      userId: string;
      email?: string;
      password?: string;
      fullName?: string;
      role?: UserRole;
      managerCode?: string;
      isActive?: boolean;
      permissions?: PermissionInput[];
    };

    const userId = String(body.userId ?? "").trim();
    if (!userId) return NextResponse.json({ error: "userId obbligatorio." }, { status: 400 });

    const email = body.email !== undefined ? normalizeEmail(body.email) : null;
    const password = body.password !== undefined ? String(body.password ?? "").trim() : null;
    const fullName = body.fullName !== undefined ? normalizeFullName(body.fullName) : undefined;
    const role = body.role !== undefined ? normalizeRole(body.role) : undefined;
    const managerCode = body.managerCode !== undefined ? normalizeManagerCode(body.managerCode) : undefined;
    const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
    if (role === "manager" && managerCode === undefined) {
      return NextResponse.json({ error: "Codice manager obbligatorio per ruolo Manager." }, { status: 400 });
    }

    const permissionsInput = Array.isArray(body.permissions) ? body.permissions : null;
    const normalizedPermissions = permissionsInput
      ? permissionsInput
          .filter((p) => p && isAppModule(p.module) && (p.level === "read" || p.level === "write"))
          .filter((p) => p.module !== "gestione")
          .map((p) => ({ module: p.module, can_write: p.level === "write" }))
      : null;

    const supabaseAdmin = createSupabaseAdminClient();

    if (email !== null || password !== null) {
      const payload: Record<string, unknown> = {};
      if (email !== null) payload.email = email;
      if (password !== null) payload.password = password;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, payload);
      if (error) throw new Error(error.message);
    }

    const roleToApply = role ?? undefined;
    const nextManagerCode =
      roleToApply === "manager" ? managerCode : roleToApply ? null : managerCode;

    if (fullName !== undefined || nextManagerCode !== undefined || isActive !== undefined || roleToApply !== undefined) {
      const profilePayload: Record<string, unknown> = {};
      if (fullName !== undefined) profilePayload.full_name = fullName;
      if (nextManagerCode !== undefined) profilePayload.manager_code = nextManagerCode;
      if (isActive !== undefined) profilePayload.is_active = isActive;
      if (roleToApply !== undefined) profilePayload.role = roleToApply;
      const { error } = await supabaseAdmin.from("profiles").update(profilePayload).eq("id", userId);
      if (error) throw new Error(error.message);
    }

    if (normalizedPermissions !== null) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      if (profileError) throw new Error(profileError.message);
      const effectiveRole = (profile as { role: UserRole }).role;

      if (effectiveRole !== "manager") {
        const { error: clearError } = await supabaseAdmin.from("module_permissions").delete().eq("user_id", userId);
        if (clearError) throw new Error(clearError.message);
        return NextResponse.json({ ok: true });
      }

      const nextKeys = new Set(normalizedPermissions.map((p) => p.module));
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("module_permissions")
        .select("module")
        .eq("user_id", userId);
      if (existingError) throw new Error(existingError.message);
      const existingKeys = new Set(((existing ?? []) as Array<{ module: AppModule }>).map((r) => r.module));
      const toDelete = Array.from(existingKeys).filter((m) => !nextKeys.has(m));

      if (toDelete.length > 0) {
        const { error: deleteError } = await supabaseAdmin
          .from("module_permissions")
          .delete()
          .eq("user_id", userId)
          .in("module", toDelete);
        if (deleteError) throw new Error(deleteError.message);
      }

      if (normalizedPermissions.length > 0) {
        const { error: upsertError } = await supabaseAdmin.from("module_permissions").upsert(
          normalizedPermissions.map((p) => ({
            user_id: userId,
            module: p.module,
            can_write: p.can_write,
          })),
          { onConflict: "user_id,module" },
        );
        if (upsertError) throw new Error(upsertError.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore aggiornamento utente." },
      { status: 500 },
    );
  }
}
