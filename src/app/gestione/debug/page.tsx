import { ModuleHeader, PanelCard } from "@/components/module-ui";

export default function GestioneDebugPage() {
  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Debug"
        description="Pagina tecnica per controlli, verifiche e diagnostica del sistema."
      />
      <PanelCard>
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Destinazione prevista</h2>
        <ul className="mt-4 space-y-2 text-sm text-slate-500">
          <li>Controlli sui dati importati.</li>
          <li>Verifiche dei log di import e delle anomalie rilevate.</li>
          <li>Strumenti di supporto all&apos;analisi senza alterare la fonte dati dominante.</li>
        </ul>
      </PanelCard>
    </div>
  );
}
