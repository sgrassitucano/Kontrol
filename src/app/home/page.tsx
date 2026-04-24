import Link from "next/link";
import { moduleDefinitions } from "@/lib/modules";
import { requireAuthenticatedPage } from "@/lib/page-access";

export default async function HomePage() {
  const { supabase } = await requireAuthenticatedPage();
  const accessEntries = await Promise.all(
    moduleDefinitions.map(async (module) => {
      const { data, error } = await supabase.rpc("has_module_access", {
        target_module: module.key,
        require_write: false,
      });
      if (error) throw new Error(error.message);
      return [module.key, Boolean(data)] as const;
    }),
  );
  const canReadByKey = new Map(accessEntries);
  const visibleModules = moduleDefinitions.filter((module) => canReadByKey.get(module.key));

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-8">
        <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-soft)]">
          Home
        </span>
        <div className="mt-4 max-w-3xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--brand-ink)]">
            Moduli applicativi
          </h1>
          <p className="text-base leading-8 text-slate-500">
            Pagina di orientamento con accesso ai moduli del gestionale.
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-3">
        {visibleModules.map((module) => (
          <article
            key={module.key}
            className="overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-[var(--brand-panel)]"
          >
            <div className={`h-2 bg-gradient-to-r ${module.accent}`} />
            <div className="space-y-5 p-6">
              <div>
                <h2 className="text-xl font-semibold text-[var(--brand-ink)]">
                  {module.label}
                </h2>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  {module.description}
                </p>
              </div>
              {module.children?.length ? (
                <ul className="space-y-3 text-sm text-slate-500">
                  {module.children.map((child) => (
                    <li key={child.href} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--brand-primary)]" />
                      <span>{child.label}: {child.description}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-7 text-slate-500">
                  Pagina madre pronta; sotto-flussi da definire quando stabilirai le regole del modulo.
                </p>
              )}
              <Link
                href={module.href}
                className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand-primary)] px-4 text-sm font-medium text-white transition hover:translate-y-[-1px] hover:shadow-[0_12px_24px_rgba(61,96,165,0.24)]"
              >
                Apri modulo
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
