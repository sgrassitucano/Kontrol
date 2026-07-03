"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  GraduationCap,
  HeartPulse,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Truck,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { moduleDefinitions, type AppModuleKey } from "@/lib/modules";

function isActive(pathname: string, href: string) {
  if (href === "/home") {
    return pathname === "/home";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

type AppShellProps = {
  children: ReactNode;
};

type MeResponse = {
  modules?: Record<string, { canRead: boolean; canWrite: boolean }>;
  profile?: {
    email: string;
    full_name: string | null;
    role: "admin" | "viewer" | "manager";
  };
};

function initialsFromIdentity(fullName: string | null | undefined, email: string | null | undefined) {
  const source = String(fullName ?? "").trim();
  if (source) {
    const parts = source
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
    return letters.toUpperCase() || "U";
  }
  const fallback = String(email ?? "").trim();
  if (!fallback) return "U";
  const normalized = fallback.replace(/[^a-z0-9]/gi, "");
  const letters = (normalized[0] ?? "") + (normalized[1] ?? "");
  return letters.toUpperCase() || "U";
}

function roleLabel(role: "admin" | "viewer" | "manager") {
  if (role === "admin") return "ADMIN";
  if (role === "viewer") return "VIEWER";
  return "MANAGER";
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const isTableFocusRoute =
    pathname.startsWith("/formazione/matrice") || pathname.startsWith("/home/formazione");
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarCollapsed = sidebarOverride ?? isTableFocusRoute;
  const [modulesByKey, setModulesByKey] = useState<Record<string, { canRead: boolean; canWrite: boolean }> | null>(null);
  const [profile, setProfile] = useState<MeResponse["profile"] | null>(null);
  const [hasBlockedImport, setHasBlockedImport] = useState(false);
  const [hasPreviewImport, setHasPreviewImport] = useState(false);
  useEffect(() => {
    // Force light mode — remove any previously saved dark preference
    localStorage.removeItem("theme");
    document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/me", { method: "GET" });
      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      if (!response.ok) return;
      const json = (await response.json()) as MeResponse;
      if (cancelled) return;
      setModulesByKey(json.modules ?? {});
      setProfile(json.profile ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

  useEffect(() => {
    if (profile?.role !== "admin") {
      setHasBlockedImport(false);
      setHasPreviewImport(false);
      return;
    }

    const fetchBadgeStatus = async () => {
      try {
        const response = await fetch("/api/import-runs/last?source=anagrafica");
        if (!response.ok) return;
        const body = (await response.json()) as { run?: { status?: string } | null };
        setHasBlockedImport(body.run?.status === "blocked");
        setHasPreviewImport(body.run?.status === "preview");
      } catch {
        // Badge is best-effort; a failed check just means no badge this load.
      }
    };

    let cancelled = false;
    void fetchBadgeStatus();
    const pollInterval = window.setInterval(() => {
      if (!cancelled) void fetchBadgeStatus();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(pollInterval);
    };
  }, [profile?.role]);

  const visibleModules = useMemo(() => {
    if (!modulesByKey) return [];
    return moduleDefinitions.filter((module) => Boolean(modulesByKey[module.key]?.canRead));
  }, [modulesByKey]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-3 py-3 md:px-4 lg:px-4 lg:py-4">
          <main className="min-h-[calc(100vh-2rem)] rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-page)] p-4 shadow-[var(--brand-shadow)] md:p-5">
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col gap-4 px-3 py-3 md:px-4 lg:flex-row lg:px-4 lg:py-4">
        <aside
          className={[
            "lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:shrink-0",
            sidebarCollapsed ? "lg:w-[84px]" : "lg:w-[280px]",
          ].join(" ")}
        >
          <div className="flex h-full flex-col rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-sidebar)] shadow-[var(--brand-shadow-soft)]">
            <div className="relative flex items-center justify-center px-2 py-3">
              {!sidebarCollapsed ? (
                <div className="w-full">
                  <BrandMark />
                </div>
              ) : (
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white text-xs font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                  {initialsFromIdentity(profile?.full_name, profile?.email)}
                </span>
              )}
              <button
                type="button"
                onClick={() => setSidebarOverride((value) => !(value ?? isTableFocusRoute))}
                className="absolute right-2 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                title={sidebarCollapsed ? "Espandi menu" : "Comprimi menu"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-2 pb-3">
              <nav className="space-y-0.5">
                {visibleModules.map((module) => {
                  const active = isActive(pathname, module.href);
                  const children = module.children ?? [];
                  const showChildren = children.length > 0 && !sidebarCollapsed;
                  const isGroupOnly = module.key === "gestione";
                  const moduleIcon = getModuleIcon(module.key);
                  const baseRowClass = sidebarCollapsed
                    ? "flex items-center justify-center rounded-xl px-2 py-1.5 text-sm font-semibold transition"
                    : "flex items-center justify-between rounded-xl px-3 py-1.5 text-sm font-semibold transition";
                  const iconWrapClass = [
                    "inline-flex h-8 w-8 items-center justify-center rounded-xl border transition",
                    active
                      ? "border-[var(--brand-primary)] bg-gradient-to-br from-[var(--brand-primary)] to-[#244ac0] text-white shadow-sm"
                      : "border-[var(--brand-line)] bg-white text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
                  ].join(" ");

                  return (
                    <div key={module.key} className="space-y-0.5">
                      {isGroupOnly ? (
                        <div
                          onClick={() => {
                            if (sidebarCollapsed) {
                              setSidebarOverride(false);
                            }
                          }}
                          className={[
                            baseRowClass,
                            active
                              ? "bg-white text-[var(--brand-primary)] shadow-[inset_0_0_0_1px_var(--brand-line)]"
                              : "text-slate-800 hover:bg-white/70 hover:text-[var(--brand-primary)]",
                          ].join(" ")}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden className={["relative", iconWrapClass].join(" ")}>
                              {moduleIcon}
                              {module.key === "gestione" && (hasBlockedImport || hasPreviewImport) ? (
                                <span
                                  title={hasBlockedImport ? "Import bloccato: serve intervento admin" : "Import in anteprima: conferma per completare"}
                                  className={["absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white", hasBlockedImport ? "bg-red-500" : "bg-amber-500"].join(" ")}
                                />
                              ) : null}
                            </span>
                            {!sidebarCollapsed ? (
                              <span className="inline-flex items-center gap-1.5">
                                {module.label}
                                {module.key === "gestione" && (hasBlockedImport || hasPreviewImport) ? (
                                  <span
                                    title={hasBlockedImport ? "Import bloccato: serve intervento admin" : "Import in anteprima: conferma per completare"}
                                    className={["inline-block h-2 w-2 rounded-full", hasBlockedImport ? "bg-red-500" : "bg-amber-500"].join(" ")}
                                  />
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ) : (
                        <Link
                          href={module.href}
                          onClick={(event) => {
                            if (sidebarCollapsed) {
                              event.preventDefault();
                              setSidebarOverride(false);
                            }
                          }}
                          className={[
                            baseRowClass,
                            active
                              ? "bg-white text-[var(--brand-primary)] shadow-[inset_0_0_0_1px_var(--brand-line)]"
                              : "text-slate-800 hover:bg-white/70 hover:text-[var(--brand-primary)]",
                          ].join(" ")}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden className={iconWrapClass}>
                              {moduleIcon}
                            </span>
                            {!sidebarCollapsed ? <span>{module.label}</span> : null}
                          </span>
                        </Link>
                      )}
                      {showChildren ? (
                        <div className="ml-2 space-y-0.5 border-l border-[var(--brand-line)] pl-3">
                          {children.map((child) => {
                            const childActive = isActive(pathname, child.href);
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={[
                                  "block rounded-lg px-2 py-0.5 text-[13px] transition",
                                  childActive
                                    ? "bg-white font-medium text-[var(--brand-primary)] shadow-[inset_0_0_0_1px_var(--brand-line)]"
                                    : "text-slate-600 hover:bg-white/70 hover:text-[var(--brand-primary)]",
                                ].join(" ")}
                              >
                                {child.label}
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </nav>

              <div className="mt-auto space-y-2 pt-3">
                {!sidebarCollapsed && profile ? (
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                      {profile.full_name?.trim() || profile.email}
                    </span>
                    <span className="shrink-0 rounded-full border border-[var(--brand-line)] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {roleLabel(profile.role)}
                    </span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-3 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  <LogOut className="h-5 w-5" />
                  {!sidebarCollapsed ? "Esci" : null}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <main className="min-h-[calc(100vh-2rem)] rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-page)] p-4 shadow-[var(--brand-shadow)] md:p-5">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function getModuleIcon(moduleKey: AppModuleKey) {
  if (moduleKey === "lavoratori") {
    return <Users className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "formazione") {
    return <GraduationCap className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "sorveglianza") {
    return <HeartPulse className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "dpi") {
    return <Shield className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "mezzi_attrezzature") {
    return <Truck className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "turni") {
    return <CalendarClock className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  if (moduleKey === "gestione") {
    return <Settings className="h-5 w-5 text-current" strokeWidth={1.8} />;
  }

  return <Settings className="h-5 w-5 text-current" strokeWidth={1.8} />;
}
