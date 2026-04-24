"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { moduleDefinitions, type AppModuleKey } from "@/lib/modules";

type PermissionLevel = "none" | "read" | "write";

type ApiPermission = { module: AppModuleKey; level: "read" | "write" };

type ApiUser = {
  id: string;
  email: string;
  role: "admin" | "manager" | "viewer";
  managerCode: string;
  isActive: boolean;
  permissions: ApiPermission[];
};

type PermissionMap = Record<AppModuleKey, PermissionLevel>;

const MODULE_KEYS = moduleDefinitions.map((m) => m.key);

function buildEmptyPermissionMap(): PermissionMap {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = "none";
    return acc;
  }, {} as PermissionMap);
}

function buildPermissionMapFromUser(user: ApiUser | null): PermissionMap {
  const base = buildEmptyPermissionMap();
  if (!user) return base;
  user.permissions.forEach((p) => {
    base[p.module] = p.level;
  });
  return base;
}

export default function GestioneUtentiPage() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<ApiUser["role"]>("manager");
  const [newManagerCode, setNewManagerCode] = useState("");
  const [newPermissions, setNewPermissions] = useState<PermissionMap>(() => buildEmptyPermissionMap());
  const [tableRefreshAt, setTableRefreshAt] = useState<Date | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<ApiUser["role"]>("manager");
  const [editManagerCode, setEditManagerCode] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editPermissions, setEditPermissions] = useState<PermissionMap>(() => buildEmptyPermissionMap());
  const [isSaving, setIsSaving] = useState(false);

  const tableRefreshText = useMemo(
    () => (tableRefreshAt ? tableRefreshAt.toLocaleTimeString("it-IT") : "-"),
    [tableRefreshAt],
  );

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/gestione/utenti");
      const body = (await response.json()) as { users?: ApiUser[]; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento utenti.");
      }
      setUsers(body.users ?? []);
      setTableRefreshAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento utenti.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void loadUsers(), 0);
    return () => clearTimeout(id);
  }, [loadUsers]);

  function normalizePermissions(map: PermissionMap) {
    return (Object.entries(map) as Array<[AppModuleKey, PermissionLevel]>)
      .filter(([, level]) => level === "read" || level === "write")
      .map(([module, level]) => ({ module, level: level as "read" | "write" }));
  }

  async function handleCreateUser() {
    const email = newEmail.trim();
    const password = newPassword.trim();
    const managerCode = newManagerCode.trim();
    if (!email || !password) return;

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/gestione/utenti", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          role: newRole,
          managerCode: newRole === "manager" ? managerCode : "",
          permissions: newRole === "manager" ? normalizePermissions(newPermissions) : [],
        }),
      });
      const body = (await response.json()) as { ok?: true; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore creazione utente.");
      }
      setNewEmail("");
      setNewPassword("");
      setNewRole("manager");
      setNewManagerCode("");
      setNewPermissions(buildEmptyPermissionMap());
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione utente.");
    } finally {
      setIsSaving(false);
    }
  }

  function openEdit(user: ApiUser) {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditPassword("");
    setEditRole(user.role);
    setEditManagerCode(user.managerCode ?? "");
    setEditIsActive(Boolean(user.isActive));
    setEditPermissions(buildPermissionMapFromUser(user));
    setIsEditOpen(true);
  }

  function closeEdit() {
    setIsEditOpen(false);
    setEditingUser(null);
    setEditEmail("");
    setEditPassword("");
    setEditRole("manager");
    setEditManagerCode("");
    setEditIsActive(true);
    setEditPermissions(buildEmptyPermissionMap());
  }

  async function saveEdit() {
    if (!editingUser) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/gestione/utenti", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          email: editEmail.trim(),
          password: editPassword.trim() ? editPassword.trim() : undefined,
          role: editRole,
          managerCode: editRole === "manager" ? editManagerCode.trim() : "",
          isActive: editIsActive,
          permissions: editRole === "manager" ? normalizePermissions(editPermissions) : [],
        }),
      });
      const body = (await response.json()) as { ok?: true; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore aggiornamento utente.");
      }
      closeEdit();
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore aggiornamento utente.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Gestione utenti
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Configura i permessi per modulo. Le sottopagine ereditano sempre il
          permesso della pagina madre.
        </p>
      </section>

      <section className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Nuovo utente
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="Indirizzo mail"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Password"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700"
          />
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as ApiUser["role"])}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700"
          >
            <option value="admin">ADMIN</option>
            <option value="viewer">VIEWER</option>
            <option value="manager">MANAGER</option>
          </select>
          <input
            type="text"
            value={newManagerCode}
            onChange={(event) => setNewManagerCode(event.target.value)}
            placeholder="Codice manager"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm uppercase text-slate-700"
            disabled={newRole !== "manager"}
          />
        </div>
        {newRole === "manager" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {moduleDefinitions
              .filter((m) => m.key !== "gestione")
              .map((module) => (
                <label
                  key={module.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2"
                >
                  <span className="text-sm font-semibold text-slate-700">{module.label}</span>
                  <select
                    value={newPermissions[module.key]}
                    onChange={(event) =>
                      setNewPermissions((prev) => ({ ...prev, [module.key]: event.target.value as PermissionLevel }))
                    }
                    className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-sm"
                  >
                    <option value="none">No</option>
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                  </select>
                </label>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            {newRole === "admin"
              ? "ADMIN: lettura/scrittura su tutto, visibilità totale."
              : "VIEWER: sola lettura su tutto (eccetto Gestione), visibilità totale."}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCreateUser}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            disabled={isSaving}
          >
            {isSaving ? "Salvo…" : "Crea"}
          </button>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
            disabled={isLoading || isSaving}
          >
            Aggiorna tabella
          </button>
          <span className="text-xs text-slate-500">
            Ultimo refresh: {tableRefreshText}
          </span>
          {isLoading ? <span className="text-xs text-slate-500">Caricamento…</span> : null}
        </div>
        {error ? <p className="mt-3 text-xs font-medium text-red-600">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-white">
        <div className="border-b border-[var(--brand-line)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--brand-ink)]">
            Utenti e moduli
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Utente</th>
                <th className="px-5 py-3">Ruolo</th>
                <th className="px-5 py-3">Codice manager</th>
                <th className="px-5 py-3">Permessi</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-[var(--brand-line)]">
                  <td className="px-5 py-4 font-medium text-[var(--brand-ink)]">
                    {user.email}
                  </td>
                  <td className="px-5 py-4 text-slate-600">{user.role}</td>
                  <td className="px-5 py-4 text-slate-600">{user.managerCode || "-"}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      {user.permissions.map((perm) => {
                        const label = moduleDefinitions.find((m) => m.key === perm.module)?.label ?? perm.module;
                        const tone =
                          perm.level === "write"
                            ? "bg-[var(--brand-tint)] text-[var(--brand-primary)]"
                            : "bg-slate-100 text-slate-700";
                        return (
                        <span
                          key={`${user.id}-${perm.module}`}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
                        >
                          {label} {perm.level === "write" ? "(W)" : "(R)"}
                        </span>
                      )})}
                      {user.permissions.length === 0 ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          Nessun permesso
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(user)}
                      className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
                    >
                      Modifica
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isEditOpen && editingUser ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
              <h2 className="text-lg font-bold text-[var(--brand-ink)]">Modifica utente</h2>
              <p className="mt-1 text-xs text-slate-500">{editingUser.email}</p>
            </div>
            <div className="overflow-auto px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nuova password</span>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(event) => setEditPassword(event.target.value)}
                    placeholder="(lascia vuoto per non cambiare)"
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ruolo</span>
                  <select
                    value={editRole}
                    onChange={(event) => setEditRole(event.target.value as ApiUser["role"])}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                  >
                    <option value="admin">ADMIN</option>
                    <option value="viewer">VIEWER</option>
                    <option value="manager">MANAGER</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Codice manager</span>
                  <input
                    value={editManagerCode}
                    onChange={(event) => setEditManagerCode(event.target.value)}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm uppercase"
                    disabled={editRole !== "manager"}
                  />
                </label>
                <label className="flex items-end justify-between gap-3 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2">
                  <span className="text-sm font-semibold text-slate-700">Attivo</span>
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(event) => setEditIsActive(event.target.checked)}
                    className="h-5 w-5 accent-[var(--brand-primary)]"
                  />
                </label>
              </div>

              <h3 className="mt-5 text-sm font-bold text-[var(--brand-ink)]">Permessi</h3>
              {editRole === "manager" ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {moduleDefinitions
                    .filter((m) => m.key !== "gestione")
                    .map((module) => (
                      <label
                        key={module.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2"
                      >
                        <span className="text-sm font-semibold text-slate-700">{module.label}</span>
                        <select
                          value={editPermissions[module.key]}
                          onChange={(event) =>
                            setEditPermissions((prev) => ({ ...prev, [module.key]: event.target.value as PermissionLevel }))
                          }
                          className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-sm"
                        >
                          <option value="none">No</option>
                          <option value="read">Read</option>
                          <option value="write">Write</option>
                        </select>
                      </label>
                    ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  {editRole === "admin"
                    ? "ADMIN: lettura/scrittura su tutto, visibilità totale."
                    : "VIEWER: sola lettura su tutto (eccetto Gestione), visibilità totale."}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--brand-line)] bg-[var(--brand-panel)] px-5 py-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
                disabled={isSaving}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                disabled={isSaving}
              >
                {isSaving ? "Salvo…" : "Salva"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
