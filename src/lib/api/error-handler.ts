import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Handles errors caught in API routes, formatting them consistently and safely.
 */
export function handleError(error: unknown, contextName: string = "API") {
  console.error(`[${contextName} Error]`, error);

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((err) => ({
      path: err.path.join("."),
      message: err.message,
    }));
    return NextResponse.json(
      {
        error: "Validazione dei dati fallita.",
        code: "VALIDATION_ERROR",
        details,
      },
      { status: 400 }
    );
  }

  // Handle generic DB or system errors, hiding raw postgres schemas in production
  const isDev = process.env.NODE_ENV === "development";
  const errorMessage = error instanceof Error ? error.message : "Errore interno del server.";

  return NextResponse.json(
    {
      error: "Si è verificato un errore durante l'operazione. Riprova più tardi.",
      code: "INTERNAL_SERVER_ERROR",
      ...(isDev && { details: errorMessage }),
    },
    { status: 500 }
  );
}
