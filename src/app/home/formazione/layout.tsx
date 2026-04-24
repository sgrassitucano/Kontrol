import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeFormazioneLayoutProps = {
  children: ReactNode;
};

export default async function HomeFormazioneLayout({ children }: HomeFormazioneLayoutProps) {
  await requirePageModuleAccess("formazione");
  return children;
}
