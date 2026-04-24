import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type SorveglianzaLayoutProps = {
  children: ReactNode;
};

export default async function SorveglianzaLayout({ children }: SorveglianzaLayoutProps) {
  await requirePageModuleAccess("sorveglianza");
  return children;
}
