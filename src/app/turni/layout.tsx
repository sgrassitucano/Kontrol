import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type TurniLayoutProps = {
  children: ReactNode;
};

export default async function TurniLayout({ children }: TurniLayoutProps) {
  await requirePageModuleAccess("turni");
  return children;
}
