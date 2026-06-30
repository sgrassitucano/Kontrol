"use client";

import Link from "next/link";
import {
  CalendarClock,
  GraduationCap,
  HeartPulse,
  Shield,
  Truck,
  Users,
  Settings,
  BookOpen,
  ArrowRight,
  Check,
  ChevronRight,
  FileSpreadsheet,
  Layers,
  FileText,
} from "lucide-react";
import { moduleDefinitions } from "@/lib/modules";

type GuideSection = {
  title: string;
  summary: string;
  cosaTrovi: string[];
  funzioniPrincipali: string[];
  pagineInterne?: string[];
  istruzioniRapide: string[];
};

export default function GuidaHomePage() {
  const guideByKey: Record<string, GuideSection> = {
    lavoratori: {
      title: "Lavoratori",
      summary: "Anagrafica centrale del personale in forza e perimetro operativo.",
      cosaTrovi: [
        "Elenco completo dei lavoratori attivi ordinato per cognome.",
        "Filtri di ricerca per nome, cognome, matricola, mansione, cantiere o responsabile.",
        "Scheda di dettaglio consolidata per ciascun dipendente.",
        "Collegamenti rapidi alle relative turnazioni, corsi e scadenze mediche."
      ],
      funzioniPrincipali: [
        "Monitorare chi è in forza, dove lavora e con quale ruolo.",
        "Consultare lo storico dei corsi, dei DPI e dei mezzi assegnati senza cambiare modulo.",
        "Accedere alle configurazioni specifiche cliccando sui tasti di rimando."
      ],
      istruzioniRapide: [
        "Usa la barra di ricerca in alto per filtrare la tabella dipendenti.",
        "Clicca sull'icona della lente (Dett.) a destra per aprire il pannello laterale.",
        "Naviga tra le tab (Dati / Turni) per consultare o saltare al relativo modulo operativo."
      ]
    },
    formazione: {
      title: "Formazione",
      summary: "Gestione delle scadenze dei corsi di formazione obbligatori e aggiuntivi.",
      cosaTrovi: [
        "Cruscotto indicatori (KPI) per monitorare lo stato di idoneità.",
        "Filtri avanzati per corso, stato di scadenza, mansione e cantiere.",
        "Matrice formazione per legare i corsi alle mansioni.",
        "Funzione di importazione massiva da tracciati esterni (file Excel)."
      ],
      funzioniPrincipali: [
        "Registrare corsi svolti o programmare sessioni per gruppi di lavoratori.",
        "Impostare deroghe ed esclusioni per specifici dipendenti.",
        "Scaricare report Excel completi delle scadenze correnti."
      ],
      pagineInterne: [
        "Matrice: Configurazione requisiti minimi di formazione legati a mansioni o cantieri.",
        "Gestione Eventi: Pianificazione collettiva di corsi svolti o da pianificare."
      ],
      istruzioniRapide: [
        "Seleziona uno o più dipendenti tramite la checkbox a sinistra nella tabella.",
        "Usa i comandi rapidi in testata per pianificare una data o registrare il corso svolto.",
        "Apri il dettaglio di un lavoratore per escluderlo da uno specifico corso (es. deroga mansione)."
      ]
    },
    sorveglianza: {
      title: "Sorveglianza sanitaria",
      summary: "Monitoraggio dell'idoneità al lavoro e delle visite mediche periodiche.",
      cosaTrovi: [
        "KPI statistici sullo stato di idoneità complessivo della forza lavoro.",
        "Tabella scadenze e note limitative imposte dal medico competente.",
        "Filtri rapidi per medici, cantieri, stati critici o dipendenti esclusi.",
        "Area di importazione massiva Excel e caricamento certificati medici PDF."
      ],
      funzioniPrincipali: [
        "Programmare le prossime visite mediche per i dipendenti.",
        "Inserire prescrizioni, limitazioni o esclusioni temporanee.",
        "Sincronizzare i dati importando direttamente i verbali medici firmati in formato PDF."
      ],
      pagineInterne: [
        "Matrice: Associazione della frequenza delle visite in base ai rischi lavorativi.",
        "Import Certificati: Caricamento massivo e parser automatico dei PDF delle visite."
      ],
      istruzioniRapide: [
        "Filtra la tabella per visualizzare i dipendenti con visite in scadenza o scadute.",
        "Clicca su un lavoratore per aprire il pannello e registrare la data della prossima visita.",
        "Se il dipendente è esente, spunta l'opzione 'Escludi da sorveglianza' motivando la scelta."
      ]
    },
    dpi: {
      title: "DPI",
      summary: "Assegnazione, tracking delle consegne e controlli periodici dei Dispositivi di Protezione.",
      cosaTrovi: [
        "Catalogo DPI aziendali suddiviso per categoria di protezione.",
        "Matrice DPI per definire le dotazioni spettanti a ciascuna mansione.",
        "Registro consegne con tracciamento delle date e dei prossimi controlli."
      ],
      funzioniPrincipali: [
        "Registrare la consegna di nuovi dispositivi firmati dai lavoratori.",
        "Pianificare le verifiche periodiche dei DPI di terza categoria (es. imbracature).",
        "Rilevare i dispositivi non ancora consegnati rispetto ai requisiti di mansione."
      ],
      pagineInterne: [
        "Matrice DPI: Associazione automatica dei dispositivi obbligatori per ruolo."
      ],
      istruzioniRapide: [
        "Verifica nella Matrice quali DPI sono richiesti per la mansione del lavoratore.",
        "Dalla scheda del lavoratore, clicca su 'DPI' per registrare la data di avvenuta consegna.",
        "Imposta la data del prossimo controllo periodico per i DPI soggetti a verifica di sicurezza."
      ]
    },
    mezzi_attrezzature: {
      title: "Mezzi e attrezzature",
      summary: "Affidamento degli asset aziendali, scadenze contrattuali e manutentive.",
      cosaTrovi: [
        "Anagrafica mezzi e attrezzature aziendali (targa, modello, codice interno).",
        "Storico assegnazioni per lavoratore con periodo di affidamento.",
        "Scadenziario degli obblighi (assicurazione, bollo, revisioni, verifiche ISPESL)."
      ],
      funzioniPrincipali: [
        "Affidare un veicolo o un'attrezzatura a un dipendente registrando le note di consegna.",
        "Monitorare le date di scadenza di manutenzioni e obblighi di legge degli asset.",
        "Gestire lo stato di disponibilità dei mezzi (attivo, fuori servizio, dismesso)."
      ],
      istruzioniRapide: [
        "Crea un nuovo mezzo o attrezzatura registrando la marca, il modello e la targa/matricola.",
        "Assegna l'asset a un dipendente indicando la data di inizio affidamento.",
        "Imposta gli obblighi periodici (es. revisione) per ricevere avvisi all'avvicinarsi della scadenza."
      ]
    },
    turni: {
      title: "Turni",
      summary: "Pianificazione operativa delle presenze, gestione delle assenze e della settimana tipo.",
      cosaTrovi: [
        "Calendario mensile con indicazione dei turni previsti, modificati ed extra.",
        "Pannello 'Settimana tipo' per definire turnazioni cicliche ricorrenti.",
        "Modale di inserimento turni singoli ed assenze (ferie, malattia, permessi).",
        "Export dei fogli di presenza in formato Excel e report immagini JPG."
      ],
      funzioniPrincipali: [
        "Configurare il cantiere e il sottocantiere operativo per ciascun dipendente.",
        "Generare automaticamente i turni mensili a partire dal modello settimanale.",
        "Inserire variazioni giornaliere e gestire le assenze con riallineamento automatico."
      ],
      pagineInterne: [
        "Vista Cantiere: Gestione ed export dei turni aggregati per cantiere e sottocantiere.",
        "Vista Lavoratori: Gestione ed export delle presenze individuali per ciascun lavoratore."
      ],
      istruzioniRapide: [
        "Seleziona il lavoratore o cantiere e configura la sua settimana tipo cliccando sui tasti '+'.",
        "Clicca su 'Riallinea mese' per rigenerare i turni del mese corrente sulla base del template.",
        "Fai doppio clic su un giorno del calendario mensile per modificare gli orari o segnare un'assenza."
      ]
    }
  };

  function getIcon(key: string) {
    const className = "h-6 w-6";
    if (key === "lavoratori") return <Users className={className} />;
    if (key === "formazione") return <GraduationCap className={className} />;
    if (key === "sorveglianza") return <HeartPulse className={className} />;
    if (key === "dpi") return <Shield className={className} />;
    if (key === "mezzi_attrezzature") return <Truck className={className} />;
    if (key === "turni") return <CalendarClock className={className} />;
    return <Settings className={className} />;
  }

  function getAccentBg(key: string) {
    if (key === "lavoratori") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    if (key === "formazione") return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20";
    if (key === "sorveglianza") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    if (key === "dpi") return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20";
    if (key === "mezzi_attrezzature") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    if (key === "turni") return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
    return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  }

  function scrollToSection(id: string) {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-gradient-to-r from-slate-900 via-slate-800 to-[var(--brand-primary)] p-8 text-white shadow-md md:p-10">
        <div className="relative z-10 max-w-3xl space-y-4">
          <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-200 backdrop-blur-sm">
            Manuale d'Uso
          </span>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl !text-white">
            KONTROL &mdash; Guida Operativa
          </h1>
          <p className="text-sm leading-relaxed text-slate-300 md:text-base md:leading-8">
            Benvenuto nel manuale d'uso integrato. Questa guida fornisce un riepilogo delle funzionalità principali e istruzioni rapide mirate per comprendere immediatamente il funzionamento di ciascun modulo del gestionale.
          </p>
        </div>
        <div className="absolute -right-16 -bottom-16 opacity-10">
          <BookOpen className="h-64 w-64" />
        </div>
      </section>

      {/* Indice Rapido */}
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h2 className="text-base font-bold text-[var(--brand-ink)] uppercase tracking-wider">Indice dei Moduli</h2>
        <p className="mt-1 text-xs text-slate-500">Seleziona un modulo per scorrere rapidamente alla sua guida ed istruzioni.</p>
        
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {moduleDefinitions.map((module) => {
            const guide = guideByKey[module.key];
            if (!guide) return null;
            return (
              <button
                key={module.key}
                onClick={() => scrollToSection(module.key)}
                className="flex items-center gap-3 rounded-xl border border-[var(--brand-line)] bg-slate-50/50 dark:bg-slate-900/50 p-3 text-left transition hover:border-[var(--brand-primary)] hover:shadow-sm group"
              >
                <div className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-current", getAccentBg(module.key)].join(" ")}>
                  {getIcon(module.key)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--brand-ink)] truncate group-hover:text-[var(--brand-primary)]">
                    {guide.title}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">Vai alla guida</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Dettaglio Moduli */}
      <section className="space-y-6">
        {moduleDefinitions.map((module) => {
          if (module.key === "gestione") return null;
          const section = guideByKey[module.key];
          if (!section) return null;

          return (
            <article
              id={module.key}
              key={module.key}
              className="scroll-mt-6 overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)]"
            >
              {/* Accento colorato */}
              <div className={["h-1.5 bg-gradient-to-r", module.accent].join(" ")} />
              
              <div className="p-6">
                {/* Header Scheda */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] pb-4">
                  <div className="flex items-center gap-3">
                    <div className={["flex h-12 w-12 items-center justify-center rounded-xl border", getAccentBg(module.key)].join(" ")}>
                      {getIcon(module.key)}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[var(--brand-ink)]">{section.title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{section.summary}</p>
                    </div>
                  </div>
                  <Link
                    href={module.href}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                  >
                    Apri modulo
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>

                {/* Corpo Scheda (Due Colonne) */}
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  {/* Cosa contiene */}
                  <div className="rounded-xl border border-[var(--brand-line)] bg-slate-50/40 dark:bg-slate-900/40 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wide">
                      <Layers className="h-4 w-4 text-slate-500" />
                      <span>Cosa contiene</span>
                    </div>
                    <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {section.cosaTrovi.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Come funziona / Istruzioni */}
                  <div className="rounded-xl border border-[var(--brand-line)] bg-slate-50/40 dark:bg-slate-900/40 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wide">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <span>Istruzioni rapide</span>
                    </div>
                    <ol className="mt-3 space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {section.istruzioniRapide.map((step, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-[10px] text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-750">
                            {idx + 1}
                          </span>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Pagine Interne / Strumenti */}
                {section.pagineInterne?.length ? (
                  <div className="mt-4 rounded-xl border border-[var(--brand-line)] bg-slate-50/40 dark:bg-slate-900/40 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wide">
                      <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                      <span>Sottosezioni e viste correlate</span>
                    </div>
                    <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {section.pagineInterne.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      {/* Sezione Ruoli */}
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[var(--brand-ink)] uppercase tracking-wider">Ruoli e Permessi</h2>
            <p className="text-xs text-slate-500 mt-0.5">L'applicazione adotta un controllo degli accessi granulare basato sui ruoli.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-blue-200/50 bg-slate-50/40 dark:bg-slate-900/40 p-4 transition hover:shadow-sm">
            <span className="inline-flex rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1 text-[10px] font-bold text-blue-700 dark:text-blue-400">
              ADMIN
            </span>
            <h3 className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Amministratore</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-405">
              Possiede l'accesso completo in lettura e scrittura a tutti i moduli del gestionale. Gestisce l'abilitazione degli utenti e visualizza i log diagnostici nella console di Gestione.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-200/50 bg-slate-50/40 dark:bg-slate-900/40 p-4 transition hover:shadow-sm">
            <span className="inline-flex rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
              VIEWER
            </span>
            <h3 className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Visualizzatore</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-405">
              Ruolo di sola lettura. Può navigare in tutti i moduli abilitati dall'amministratore, scaricare report ed esportare dati senza possibilità di effettuare modifiche.
            </p>
          </div>

          <div className="rounded-xl border border-violet-200/50 bg-slate-50/40 dark:bg-slate-900/40 p-4 transition hover:shadow-sm">
            <span className="inline-flex rounded-full bg-violet-100 dark:bg-violet-900/30 px-2.5 py-1 text-[10px] font-bold text-violet-700 dark:text-violet-400">
              MANAGER
            </span>
            <h3 className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Manager Operativo</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-405">
              Dispone di permessi di lettura/scrittura ristretti al proprio perimetro operativo (cantieri, responsabili o lavoratori a lui specificamente assegnati in anagrafica).
            </p>
          </div>
        </div>
      </section>

      {/* Note Pratiche */}
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h2 className="text-base font-bold text-[var(--brand-ink)]">Note Pratiche e Risoluzione Problemi</h2>
        <div className="mt-4 grid gap-4 text-xs text-slate-650 sm:grid-cols-2 md:grid-cols-3">
          <div className="space-y-1">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Accesso Negato</p>
            <p className="leading-relaxed text-slate-500 dark:text-slate-400">
              Se visualizzi questo avviso, significa che il tuo utente non ha i permessi di lettura per quel modulo. Contatta un amministratore per aggiornare il tuo profilo.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Filtro Perimetro</p>
            <p className="leading-relaxed text-slate-500 dark:text-slate-400">
              Per i MANAGER, i dati mostrati dipendono esclusivamente dai cantieri associati. Non verranno visualizzate informazioni relative ad altre sedi lavorative.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Disallineamento Dati</p>
            <p className="leading-relaxed text-slate-500 dark:text-slate-400">
              Tutti i dati dell'applicazione derivano dal file anagrafica centrale più recente. In caso di incongruenze, verifica la corretta importazione del tracciato Excel.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
