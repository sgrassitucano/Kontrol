import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeLavoratoriLayoutProps = {
  children: ReactNode;
};

export default async function HomeLavoratoriLayout({ children }: HomeLavoratoriLayoutProps) {
  await requirePageModuleAccess("lavoratori");
  return children;
}
