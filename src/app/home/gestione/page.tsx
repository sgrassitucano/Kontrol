import Link from "next/link";

export default function HomeGestionePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Gestione
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Area amministrativa per controllare import anagrafica, utenti e
          strumenti di verifica.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href="/gestione/import"
          className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5 transition hover:border-[var(--brand-primary)]"
        >
          <p className="text-sm font-semibold text-[var(--brand-ink)]">
            Import anagrafica
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Carica il file, valida i dati e applica lo snapshot attivo/dimesso.
          </p>
        </Link>
        <Link
          href="/gestione/utenti"
          className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5 transition hover:border-[var(--brand-primary)]"
        >
          <p className="text-sm font-semibold text-[var(--brand-ink)]">
            Utenti e permessi
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Definisci i moduli visibili e i permessi di scrittura per ogni
            utente.
          </p>
        </Link>
        <Link
          href="/gestione/debug"
          className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5 transition hover:border-[var(--brand-primary)]"
        >
          <p className="text-sm font-semibold text-[var(--brand-ink)]">Debug</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Verifica log, errori e consistenza dati durante le fasi di import.
          </p>
        </Link>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
          <h2 className="text-base font-semibold text-[var(--brand-ink)]">
            Stato import
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-500">
            <li>Ultimo file: non ancora registrato</li>
            <li>Righe processate: -</li>
            <li>Errori: -</li>
            <li>Dimessi aggiornati: -</li>
          </ul>
        </article>
        <article className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
          <h2 className="text-base font-semibold text-[var(--brand-ink)]">
            Controllo accessi
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-500">
            <li>Modulo gestione riservato a utenti autorizzati.</li>
            <li>Le pagine figlie ereditano il permesso della madre.</li>
            <li>Write comprende anche read.</li>
            <li>Nessun permesso assegnato: accesso negato.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
