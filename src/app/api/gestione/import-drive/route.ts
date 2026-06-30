import { NextResponse } from "next/server";
import { processAnagraficaImport } from "@/lib/import/anagrafica";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

// helper function to get Google Access Token using Service Account JSON credentials
async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const creds = JSON.parse(serviceAccountJson);
  const privateKey = creds.private_key;
  const clientEmail = creds.client_email;
  const tokenUrl = creds.token_uri || "https://oauth2.googleapis.com/token";

  // Create JWT Header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // Create JWT Claim Set
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: tokenUrl,
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (str: string) => {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimB64 = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${headerB64}.${claimB64}`;

  // Sign JWT with private key using crypto module
  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, "base64");
  const signatureB64 = signature
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signatureInput}.${signatureB64}`;

  // Fetch access token
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Authentication failed: ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const mode = String(body.mode ?? "preview");
    const fileId = String(body.fileId ?? "").trim();
    const confirmHighDismissals = Boolean(body.confirmHighDismissals);
    const confirmCriticalDismissals = Boolean(body.confirmCriticalDismissals);
    const overrideBlockedDismissals = Boolean(body.overrideBlockedDismissals);
    const confirmDismissalPhrase = String(body.confirmDismissalPhrase ?? "");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json(
        { error: "Modalità non valida. Usa preview o commit." },
        { status: 400 },
      );
    }

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID di Google Drive non inserito." },
        { status: 400 },
      );
    }

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      return NextResponse.json(
        { error: "Credenziali Google Drive non configurate sul server (GOOGLE_SERVICE_ACCOUNT_JSON mancante)." },
        { status: 500 },
      );
    }

    // 1. Authenticate and get Token
    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccountJson);
    } catch (authErr) {
      return NextResponse.json(
        { error: `Errore autenticazione Google: ${authErr instanceof Error ? authErr.message : "Dettagli sconosciuti"}` },
        { status: 500 },
      );
    }

    // 2. Fetch File Metadata from Google Drive to get the file name
    const metaResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!metaResponse.ok) {
      const errTxt = await metaResponse.text();
      return NextResponse.json(
        { error: `Impossibile leggere metadati del file da Drive: ${metaResponse.statusText}. Dettagli: ${errTxt}` },
        { status: metaResponse.status }
      );
    }

    const metadata = await metaResponse.json();
    const fileName = metadata.name || "import_drive.xlsx";

    // 3. Download actual media content of the file
    const mediaResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!mediaResponse.ok) {
      const errTxt = await mediaResponse.text();
      return NextResponse.json(
        { error: `Errore download file da Drive: ${mediaResponse.statusText}. Dettagli: ${errTxt}` },
        { status: mediaResponse.status }
      );
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const supabase = auth.supabase;
    const importedBy = auth.userId;

    // 4. Process the import using existing logic
    const result = await processAnagraficaImport({
      fileBuffer: arrayBuffer,
      fileName,
      mode,
      supabase,
      importedBy,
      confirmHighDismissals,
      confirmCriticalDismissals,
      overrideBlockedDismissals,
      confirmDismissalPhrase,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Errore imprevisto durante l'import da Google Drive.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
