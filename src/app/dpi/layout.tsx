import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type DpiLayoutProps = {
  children: ReactNode;
};

export default async function DpiLayout({ children }: DpiLayoutProps) {
  await requirePageModuleAccess("dpi");
  return children;
}
