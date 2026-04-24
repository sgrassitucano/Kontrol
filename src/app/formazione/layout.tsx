import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type FormazioneLayoutProps = {
  children: ReactNode;
};

export default async function FormazioneLayout({ children }: FormazioneLayoutProps) {
  await requirePageModuleAccess("formazione");
  return children;
}
