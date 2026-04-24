import { PageFrame } from "@/components/page-frame";

export default function HomeSorveglianzaPage() {
  return (
    <PageFrame
      eyebrow="Home / Sorveglianza sanitaria"
      title="Sorveglianza sanitaria"
      description="Landing del modulo sanitario con accesso alle due pagine figlie gia richieste. Nessuna assunzione sulle regole di business finche non verranno definite."
      actions={[
        { label: "Apri matrice", href: "/sorveglianza_sanitaria/matrice" },
        { label: "Apri import", href: "/sorveglianza_sanitaria/import" },
      ]}
      sections={[
        {
          title: "Stato attuale",
          items: [
            "Modulo raggiungibile dalla home e dalla sidebar.",
            "Sottopagine coerenti con il permesso della pagina madre.",
            "Nessun contenuto sanitario inventato in anticipo.",
          ],
        },
      ]}
    />
  );
}
