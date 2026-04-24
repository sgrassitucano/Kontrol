import type { ReactNode } from "react";
import { requirePageModuleAccess } from "@/lib/page-access";

type HomeMezziAttrezzatureLayoutProps = {
  children: ReactNode;
};

export default async function HomeMezziAttrezzatureLayout({
  children,
}: HomeMezziAttrezzatureLayoutProps) {
  await requirePageModuleAccess("mezzi_attrezzature");
  return children;
}
