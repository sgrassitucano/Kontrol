import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type FormazioneMatriceLayoutProps = {
  children: ReactNode;
};

export default async function FormazioneMatriceLayout({ children }: FormazioneMatriceLayoutProps) {
  await requirePageModuleAccess("gestione");
  return children;
}
