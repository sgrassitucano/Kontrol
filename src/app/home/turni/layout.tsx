import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeTurniLayoutProps = {
  children: ReactNode;
};

export default async function HomeTurniLayout({ children }: HomeTurniLayoutProps) {
  await requirePageModuleAccess("turni");
  return children;
}
