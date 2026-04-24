import type { ReactNode } from "react";
import { requireAnyOperationalPageAccess } from "@/lib/page-access";

type HomeLayoutProps = {
  children: ReactNode;
};

export default async function HomeLayout({ children }: HomeLayoutProps) {
  await requireAnyOperationalPageAccess();
  return children;
}
