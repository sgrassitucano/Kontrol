export type AppModuleKey =
  | "lavoratori"
  | "formazione"
  | "sorveglianza"
  | "dpi"
  | "mezzi_attrezzature"
  | "turni"
  | "gestione";

export type ModuleRoute = {
  label: string;
  href: string;
  description: string;
};

export type ModuleDefinition = {
  key: AppModuleKey;
  label: string;
  href: string;
  description: string;
  accent: string;
  children?: ModuleRoute[];
};

export const moduleDefinitions: ModuleDefinition[] = [
  {
    key: "lavoratori",
    label: "Lavoratori",
    href: "/home/lavoratori",
    description: "Anagrafica centrale, stato in forza e futuro pannello di dettaglio.",
    accent: "from-[#4d6eb3] to-[#7f9fd1]",
  },
  {
    key: "formazione",
    label: "Formazione",
    href: "/home/formazione",
    description: "Gestione scadenze corsi, cruscotto e import massivo su Formazione.",
    accent: "from-[#3f5e9d] to-[#6f92c8]",
    children: [
      {
        label: "Pianificazione",
        href: "/home/formazione/pianificazione",
        description: "Raggruppa e programma i fabbisogni formativi.",
      },
      {
        label: "Matrice",
        href: "/formazione/matrice",
        description: "Vista placeholder per la matrice formazione.",
      },
    ],
  },
  {
    key: "sorveglianza",
    label: "Sorveglianza sanitaria",
    href: "/home/sorveglianza_sanitaria",
    description: "Modulo scheletro con matrice e import separati.",
    accent: "from-[#35548f] to-[#6d87b7]",
    children: [
      {
        label: "Matrice",
        href: "/sorveglianza_sanitaria/matrice",
        description: "Vista placeholder per la matrice sanitaria.",
      },
      {
        label: "Import",
        href: "/sorveglianza_sanitaria/import",
        description: "Area placeholder per import sanitari.",
      },
    ],
  },
  {
    key: "dpi",
    label: "DPI",
    href: "/home/dpi",
    description: "Modulo scheletro con matrice dedicata.",
    accent: "from-[#4666aa] to-[#90add7]",
    children: [
      {
        label: "Matrice",
        href: "/dpi/matrice",
        description: "Vista placeholder per la matrice DPI.",
      },
    ],
  },
  {
    key: "mezzi_attrezzature",
    label: "Mezzi e attrezzature",
    href: "/home/mezzi_attrezzature",
    description: "Landing del modulo in attesa delle regole di dominio.",
    accent: "from-[#5376ba] to-[#8ba9d5]",
  },
  {
    key: "turni",
    label: "Turni",
    href: "/home/turni",
    description: "Modulo scheletro con viste dedicate per cantiere e lavoratori.",
    accent: "from-[#4967a1] to-[#88a4cc]",
    children: [
      {
        label: "Cantiere",
        href: "/turni/cantiere",
        description: "Vista placeholder turni per cantiere.",
      },
      {
        label: "Lavoratori",
        href: "/turni/lavoratori",
        description: "Vista placeholder turni per lavoratore.",
      },
    ],
  },
  {
    key: "gestione",
    label: "Gestione",
    href: "/home/gestione",
    description: "Amministrazione, import anagrafica, utenti e debug.",
    accent: "from-[#27457c] to-[#5474b0]",
    children: [
      {
        label: "Import",
        href: "/gestione/import",
        description: "Import anagrafica dominante con preview e report errori.",
      },
      {
        label: "Utenti",
        href: "/gestione/utenti",
        description: "Assegnazione permessi per modulo agli utenti.",
      },
      {
        label: "Backup",
        href: "/gestione/backup",
        description: "Esporta copie di sicurezza ed esegui il ripristino atomico.",
      },
    ],
  },
];

export const operationalModules = moduleDefinitions.filter(
  (module) => module.key !== "gestione",
);

export const quickLinks = [
  { label: "Home", href: "/home" },
  ...moduleDefinitions.flatMap((module) => [
    { label: module.label, href: module.href },
    ...(module.children ?? []).map((child) => ({
      label: `${module.label} / ${child.label}`,
      href: child.href,
    })),
  ]),
];
