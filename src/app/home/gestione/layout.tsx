import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeGestioneLayoutProps = {
  children: ReactNode;
};

export default async function HomeGestioneLayout({ children }: HomeGestioneLayoutProps) {
  await requirePageModuleAccess("gestione");
  return children;
}
