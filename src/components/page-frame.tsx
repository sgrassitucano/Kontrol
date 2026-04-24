import Link from "next/link";
import type { ReactNode } from "react";

export type PageAction = {
  label: string;
  href: string;
};

export type PageSection = {
  title: string;
  items: string[];
};

type PageFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: PageAction[];
  sections?: PageSection[];
  aside?: ReactNode;
};

export function PageFrame({
  eyebrow,
  title,
  description,
  actions = [],
  sections = [],
  aside,
}: PageFrameProps) {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 rounded-[28px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-8 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {eyebrow ? (
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-soft)]">
              {eyebrow}
            </span>
          ) : null}
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--brand-ink)] md:text-4xl">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-500 md:text-base">
              {description}
            </p>
          </div>
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {actions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-[24px] border border-[var(--brand-line)] bg-white p-5">
          {aside ?? (
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand-soft)]">
                Stato pagina
              </p>
              <p className="text-sm leading-7 text-slate-500">
                Scheletro pronto, contenuti di dominio da definire passo per passo.
              </p>
            </div>
          )}
        </div>
      </section>

      {sections.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6"
            >
              <h2 className="text-lg font-semibold text-[var(--brand-ink)]">
                {section.title}
              </h2>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-500">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
