import Link from "next/link";

export default function NoAccessPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Accesso negato
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Il tuo account non ha i permessi necessari per visualizzare questa pagina.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand-primary)] px-4 text-sm font-medium text-white transition hover:brightness-95"
        >
          Vai alla Home
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--brand-line)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--brand-primary)]"
        >
          Cambia account
        </Link>
      </div>
    </div>
  );
}
