import { NextResponse } from "next/server";
import { requireModuleAccess, requireAnyModuleAccess } from "./access";
import type { AppModuleKey } from "../modules";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthenticatedUserContext = {
  supabase: SupabaseClient;
  userId: string;
};

export type AuthenticatedRouteHandler = (
  request: Request,
  context: any,
  userContext: AuthenticatedUserContext
) => Promise<Response> | Response;

/**
 * Middleware wrapper that validates the user session and checks access permissions for a specific module.
 */
export function withModuleAccess(
  module: AppModuleKey,
  requireWrite: boolean,
  handler: AuthenticatedRouteHandler
) {
  return async (request: Request, context: any) => {
    const auth = await requireModuleAccess(module, requireWrite);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    return handler(request, context, { supabase: auth.supabase, userId: auth.userId });
  };
}

/**
 * Middleware wrapper that validates the user session and checks access permissions for any of the specified modules.
 */
export function withAnyModuleAccess(
  modules: AppModuleKey[],
  requireWrite: boolean,
  handler: AuthenticatedRouteHandler
) {
  return async (request: Request, context: any) => {
    const auth = await requireAnyModuleAccess(modules, requireWrite);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    return handler(request, context, { supabase: auth.supabase, userId: auth.userId });
  };
}
