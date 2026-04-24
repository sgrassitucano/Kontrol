import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeDpiLayoutProps = {
  children: ReactNode;
};

export default async function HomeDpiLayout({ children }: HomeDpiLayoutProps) {
  await requirePageModuleAccess("dpi");
  return children;
}
