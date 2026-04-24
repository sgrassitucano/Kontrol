import { moduleDefinitions } from "@/lib/modules";

type GuideSection = {
  title: string;
  summary?: string;
  cosaTrovi: string[];
  funzioniPrincipali: string[];
  pagineInterne?: string[];
};

const guideByKey: Record<string, GuideSection> = {
  lavoratori: {
    title: "Lavoratori",
    cosaTrovi: [
      "Elenco lavoratori attivi (con cantiere/sottocantiere).",
      "Ricerca per persona/perimetro (mansione, responsabile, referente).",
      "Dettaglio lavoratore con stato formazione, sorveglianza sanitaria, DPI, mezzi/attrezzature assegnate e turnazioni.",
      "In caso di assenza di dati il campo sarà vuoto.",
    ],
    funzioniPrincipali: [
      "Controllo rapido “chi è in forza” e “dove lavora”.",
      "Verifica stati collegati senza cambiare pagina.",
      "Vista per responsabile: un MANAGER vede solo i suoi lavoratori.",
    ],
  },
  formazione: {
    title: "Formazione",
    summary: "Gestione scadenze corsi, cruscotto e import massivo delle modifiche.",
    cosaTrovi: [
      "Cruscotto con stati (scaduto/da fare, in scadenza, programmato).",
      "Tabella dettaglio per lavoratore+corso, con date e note.",
      "Export in Excel per condivisione e reportistica.",
    ],
    funzioniPrincipali: [
      "Monitorare scadenze e corsi da pianificare.",
      "Gestire import e correzioni/override dove previsto.",
      "Evidenziare casi da attenzionare quando richiesto.",
    ],
    pagineInterne: [
      "Matrice: costruzione delle esigenze formative in base alla mansione o al cantiere/sottocantiere del lavoratore.",
    ],
  },
  sorveglianza: {
    title: "Sorveglianza sanitaria",
    summary: "Gestione scadenze visite mediche, cruscotto e import massivo delle modifiche.",
    cosaTrovi: [
      "Cruscotto con stati (scaduto/da fare, in scadenza, programmato).",
      "Tabella dettaglio per lavoratore+visita medica, con date e note.",
      "Export in Excel per condivisione e reportistica.",
    ],
    funzioniPrincipali: [
      "Monitorare scadenze e visite da pianificare.",
      "Gestire import e correzioni/override dove previsto.",
      "Evidenziare casi da attenzionare quando richiesto.",
    ],
    pagineInterne: [
      "Matrice: costruzione delle esigenze della sorveglianza sanitaria in base alla mansione o al cantiere/sottocantiere del lavoratore.",
    ],
  },
  dpi: {
    title: "DPI",
    summary: "Gestione consegne, controlli e scadenze dei DPI per lavoratore.",
    cosaTrovi: [
      "Catalogo DPI e regole di assegnazione (matrice).",
      "Dettaglio per lavoratore con date consegna, prossimi controlli e note.",
      "Stati operativi (consegnato, da consegnare, da verificare, scaduto, programmato).",
    ],
    funzioniPrincipali: [
      "Monitorare consegne e verifiche da eseguire.",
      "Tenere traccia della prossima data di controllo e delle note.",
      "Allineare assegnazioni e perimetro lavoratori/cantieri.",
    ],
    pagineInterne: ["Matrice: definizione regole DPI per mansione o perimetro operativo."],
  },
  mezzi_attrezzature: {
    title: "Mezzi e attrezzature",
    summary: "Gestione anagrafica mezzi/attrezzature, assegnazioni e obblighi (scadenze/manutenzioni).",
    cosaTrovi: [
      "Anagrafica mezzi/attrezzature con stato e identificativi (targa/codici).",
      "Assegnazioni ai lavoratori con periodo e note.",
      "Obblighi e scadenze (eventi di controllo/manutenzione).",
    ],
    funzioniPrincipali: [
      "Tenere sotto controllo manutenzioni e obblighi.",
      "Vedere chi ha cosa in carico e da quando.",
      "Registrare eventi e aggiornare scadenze operative.",
    ],
  },
  turni: {
    title: "Turni",
    summary: "Pianificazione turni con template, assegnazioni e controllo coperture per cantiere/sottocantiere.",
    cosaTrovi: [
      "Cruscotto mensile: turni attesi vs assegnati, ore e percentuali.",
      "Tabella lavoratori con cantiere/sottocantiere e stato turno assegnato.",
      "Gestione template e generazione turni per perimetro operativo.",
    ],
    funzioniPrincipali: [
      "Impostare la settimana tipo e le fasce orarie del perimetro.",
      "Allocare persone e controllare buchi di copertura.",
      "Gestire sottocantieri quando il cantiere è contenitore.",
    ],
    pagineInterne: [
      "Cantiere: configurazione template e gestione turni per cantiere/sottocantiere.",
      "Lavoratori: vista per lavoratore e verifiche di assegnazione.",
    ],
  },
};

export default function GuidaHomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-8">
        <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-soft)]">
          Manuale
        </span>
        <div className="mt-4 max-w-4xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--brand-ink)]">
            Manuale
          </h1>
          <p className="text-base leading-8 text-slate-500">
            Questa pagina spiega come è organizzato il gestionale con il dettaglio di ogni modulo.
          </p>
        </div>
      </section>

      <section className="rounded-[24px] border border-[var(--brand-line)] bg-white p-6">
        <h2 className="text-lg font-semibold text-[var(--brand-ink)]">Concetti e Ruoli</h2>
        <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">
          <p>
            L’app è divisa in moduli. Ogni modulo ha pagine madri e, quando previsto, pagine figlie.
          </p>
          <div>
            <p className="font-semibold text-slate-800">
              I permessi sono basati su ruolo (ADMIN/VIEWER/MANAGER) e su abilitazioni per modulo:
            </p>
            <ul className="mt-2 space-y-2">
              <li>
                <span className="font-semibold text-slate-800">ADMIN:</span> permessi di lettura/scrittura
                su tutte le pagine; gestione delle impostazioni utenti e monitoraggio attività;
              </li>
              <li>
                <span className="font-semibold text-slate-800">VIEWER:</span> permessi di lettura su tutte
                le pagine.
              </li>
              <li>
                <span className="font-semibold text-slate-800">MANAGER:</span> permessi di lettura/scrittura
                sulle pagine a cui l'admin permette l'accesso; permesso di lettura/scrittura su
                cantieri/operatori a lui assegnati dall'anagrafica lavoratori.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-[var(--brand-line)] bg-white p-6">
        <h2 className="text-lg font-semibold text-[var(--brand-ink)]">MAPPA PAGINE E FUNZIONI</h2>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Di seguito trovi l’elenco delle aree principali. Il contenuto visibile può cambiare in
          base ai permessi assegnati.
        </p>

        <div className="mt-5 space-y-4">
          {moduleDefinitions.map((module) => {
            if (module.key === "gestione") return null;
            const section = guideByKey[module.key];
            if (!section) return null;

            return (
              <article
                key={module.key}
                className="rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]/25 p-5"
              >
                <div>
                  <p className="text-base font-semibold text-[var(--brand-ink)]">{section.title}</p>
                  {section.summary ? (
                    <p className="mt-2 text-sm leading-7 text-slate-600">{section.summary}</p>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-[18px] border border-[var(--brand-line)] bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800">Cosa trovi</p>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                      {section.cosaTrovi.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-[18px] border border-[var(--brand-line)] bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800">Funzioni principali</p>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                      {section.funzioniPrincipali.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {section.pagineInterne?.length ? (
                  <div className="mt-4 rounded-[18px] border border-[var(--brand-line)] bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800">Pagine interne</p>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                      {section.pagineInterne.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--brand-ink)]">Note pratiche</h2>
        <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
          <li>
            Se una pagina ti risulta “Accesso negato”, significa che il tuo profilo non ha quel
            modulo abilitato o non sei attivo.
          </li>
          <li>
            I dati sono filtrati per perimetro quando lavori come MANAGER: cantieri, sottocantieri e
            lavoratori dipendono dal tuo codice in anagrafica.
          </li>
          <li>
            In caso di dubbi su numeri e stati, la fonte è sempre l’anagrafica importata più recente
            e le regole del modulo specifico.
          </li>
        </ul>
      </section>
    </div>
  );
}
