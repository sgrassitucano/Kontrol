import { PageFrame } from "@/components/page-frame";

export default function SorveglianzaMatricePage() {
  return (
    <PageFrame
      eyebrow="Sorveglianza sanitaria / Matrice"
      title="Matrice sorveglianza sanitaria"
      description="Placeholder della matrice sanitaria. E strutturalmente pronta ma attende le regole operative e i criteri di lettura dei dati."
      sections={[
        {
          title: "Base pronta",
          items: [
            "Routing definito.",
            "Layout coerente al resto della piattaforma.",
            "Permessi modulo predisposti nella base RLS.",
          ],
        },
      ]}
    />
  );
}
