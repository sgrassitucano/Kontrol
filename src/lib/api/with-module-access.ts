import { NextResponse } from "next/server";
import { requireModuleAccess, requireAnyModuleAccess } from "./access";
import type { AppModuleKey } from "../modules";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthenticatedUserContext = {
  supabase: SupabaseClient;
  userId: string;
};

export type RouteContext = { params: Promise<Record<string, string>> };

export type AuthenticatedRouteHandler = (
  request: Request,
  context: RouteContext,
  userContext: AuthenticatedUserContext
) => Promise<Response> | Response;

export function withModuleAccess(
  module: AppModuleKey,
  requireWrite: boolean,
  handler: AuthenticatedRouteHandler
) {
  return async (request: Request, context: RouteContext) => {
    const auth = await requireModuleAccess(module, requireWrite);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    return handler(request, context, { supabase: auth.supabase, userId: auth.userId });
  };
}

export function withAnyModuleAccess(
  modules: AppModuleKey[],
  requireWrite: boolean,
  handler: AuthenticatedRouteHandler
) {
  return async (request: Request, context: RouteContext) => {
    const auth = await requireAnyModuleAccess(modules, requireWrite);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    return handler(request, context, { supabase: auth.supabase, userId: auth.userId });
  };
}
