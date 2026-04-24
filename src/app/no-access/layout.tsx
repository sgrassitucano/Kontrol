import type { ReactNode } from "react";
import { requireAuthenticatedPage } from "@/lib/page-access";

type NoAccessLayoutProps = {
  children: ReactNode;
};

export default async function NoAccessLayout({ children }: NoAccessLayoutProps) {
  await requireAuthenticatedPage();
  return children;
}
