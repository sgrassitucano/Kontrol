import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LoginLayoutProps = {
  children: ReactNode;
};

export default async function LoginLayout({ children }: LoginLayoutProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home/guida");
  return children;
}
