import { PageFrame } from "@/components/page-frame";

export default function GestioneDebugPage() {
  return (
    <PageFrame
      eyebrow="Gestione / Debug"
      title="Debug"
      description="Pagina tecnica per controlli, verifiche e diagnostica del sistema. Per ora e una shell deliberatamente neutra, pronta a ricevere strumenti solo quando saranno definiti."
      sections={[
        {
          title: "Destinazione prevista",
          items: [
            "Controlli sui dati importati.",
            "Verifiche dei log di import e delle anomalie rilevate.",
            "Strumenti di supporto all'analisi senza alterare la fonte dati dominante.",
          ],
        },
      ]}
    />
  );
}
