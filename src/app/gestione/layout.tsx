import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type GestioneLayoutProps = {
  children: ReactNode;
};

export default async function GestioneLayout({ children }: GestioneLayoutProps) {
  await requirePageModuleAccess("gestione");
  return children;
}
