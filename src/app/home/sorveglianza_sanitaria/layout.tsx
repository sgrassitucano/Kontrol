import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeSorveglianzaLayoutProps = {
  children: ReactNode;
};

export default async function HomeSorveglianzaLayout({ children }: HomeSorveglianzaLayoutProps) {
  await requirePageModuleAccess("sorveglianza");
  return children;
}
