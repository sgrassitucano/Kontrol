import { PageFrame } from "@/components/page-frame";

export default function SorveglianzaImportPage() {
  return (
    <PageFrame
      eyebrow="Sorveglianza sanitaria / Import"
      title="Import sorveglianza sanitaria"
      description="Shell tecnica dedicata ai futuri import del modulo sanitario, volutamente separata dal flusso anagrafico dominante."
      sections={[
        {
          title: "Perimetro",
          items: [
            "Area destinata agli import del modulo.",
            "Nessun contenuto anticipato prima di definire il tracciato reale.",
            "Struttura pronta per controlli permessi e collegamento dati condivisi.",
          ],
        },
      ]}
    />
  );
}
