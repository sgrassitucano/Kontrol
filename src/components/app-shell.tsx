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

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const isTableFocusRoute =
    pathname.startsWith("/formazione/matrice") || pathname.startsWith("/home/formazione");
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarCollapsed = sidebarOverride ?? isTableFocusRoute;
  const [modulesByKey, setModulesByKey] = useState<Record<string, { canRead: boolean; canWrite: boolean }> | null>(null);

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
      const json = (await response.json()) as { modules?: Record<string, { canRead: boolean; canWrite: boolean }> };
      if (cancelled) return;
      setModulesByKey(json.modules ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

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
          <main className="min-h-[calc(100vh-2rem)] rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4 shadow-[var(--brand-shadow)] md:p-5">
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
          <div className="flex h-full flex-col rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-panel)] shadow-[var(--brand-shadow-soft)]">
            <div className="rounded-[26px] bg-[var(--brand-panel-2)] p-4">
              <div className="flex items-center justify-between gap-2">
                {!sidebarCollapsed ? (
                  <BrandMark />
                ) : (
                  <span className="text-xs font-semibold text-slate-500">GM</span>
                )}
                <button
                  type="button"
                  onClick={() => setSidebarOverride((value) => !(value ?? isTableFocusRoute))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  title={sidebarCollapsed ? "Espandi menu" : "Comprimi menu"}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
                </button>
              </div>
            <nav className="mt-4 space-y-1.5">
              {visibleModules.map((module) => {
                const active = isActive(pathname, module.href);
                const children = module.children ?? [];
                const showChildren = children.length > 0 && !sidebarCollapsed;
                const isGroupOnly = module.key === "gestione";
                const moduleIcon = getModuleIcon(module.key);
                const baseRowClass = sidebarCollapsed
                  ? "flex items-center justify-center rounded-xl px-2 py-2.5 text-sm font-semibold transition"
                  : "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition";
                const iconWrapClass = [
                  "inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition",
                  active
                    ? "border-[var(--brand-primary)] bg-gradient-to-br from-[var(--brand-primary)] to-[#244ac0] text-white shadow-sm"
                    : "border-[var(--brand-line)] bg-white text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
                ].join(" ");

                return (
                  <div key={module.key} className="space-y-1">
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
                            ? "bg-[var(--brand-tint)] text-[var(--brand-primary)]"
                            : "text-slate-800 hover:bg-white hover:text-[var(--brand-primary)]",
                        ].join(" ")}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className={iconWrapClass}>
                            {moduleIcon}
                          </span>
                          {!sidebarCollapsed ? <span>{module.label}</span> : null}
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
                            ? "bg-[var(--brand-tint)] text-[var(--brand-primary)]"
                            : "text-slate-800 hover:bg-white hover:text-[var(--brand-primary)]",
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
                      <div className="ml-2 space-y-1 border-l border-[var(--brand-line)] pl-3">
                        {children.map((child) => {
                          const childActive = isActive(pathname, child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={[
                                "block rounded-lg px-2.5 py-1.5 text-[13px] transition",
                                childActive
                                  ? "bg-white font-medium text-[var(--brand-primary)]"
                                  : "text-slate-600 hover:bg-white hover:text-[var(--brand-primary)]",
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

            <button
              type="button"
              onClick={logout}
              className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            >
              <LogOut className="h-5 w-5" />
              {!sidebarCollapsed ? "Esci" : null}
            </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <main className="min-h-[calc(100vh-2rem)] rounded-[26px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4 shadow-[var(--brand-shadow)] md:p-5">
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
