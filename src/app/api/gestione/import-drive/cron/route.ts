import { NextResponse } from "next/server";
import { getGoogleAccessToken, listFilesInFolder, getFileContent } from "@/lib/google-drive";
import { processAnagraficaImport } from "@/lib/import/anagrafica";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Vercel Cron uses Authorization header for security
// Format: Authorization: Bearer <vercel-cron-secret>
// We compare against VERCEL_CRON_SECRET env var

export async function POST(request: Request) {
  // TEMPORARY: auth disabled for debugging — re-enable after testing
  // const authHeader = request.headers.get("Authorization") || "";
  // const cronSecret = process.env.VERCEL_CRON_SECRET;
  // if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
  //   return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  // }

  try {
    const folderIdEnv = process.env.GOOGLE_DRIVE_IMPORT_FOLDER_ID;
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!folderIdEnv || !serviceAccountJson) {
      return NextResponse.json(
        {
          error: "Cron config incomplete: GOOGLE_DRIVE_IMPORT_FOLDER_ID or GOOGLE_SERVICE_ACCOUNT_JSON missing",
        },
        { status: 500 }
      );
    }

    // 1. Authenticate
    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    // 2. List files in folder, sorted by modifiedTime desc
    const files = await listFilesInFolder(folderIdEnv, accessToken);
    if (files.length === 0) {
      return NextResponse.json(
        { message: "No files found in import folder" },
        { status: 200 }
      );
    }

    // 3. Get the most recent file
    const latestFile = files[0];

    // 4. Download file content
    const arrayBuffer = await getFileContent(latestFile.id, accessToken);

    // 5. Process import in preview mode (user must confirm via UI)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: "Supabase credentials missing" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const result = await processAnagraficaImport({
      fileBuffer: arrayBuffer,
      fileName: latestFile.name,
      mode: "preview",
      supabase,
      importedBy: null, // Cron run, no user
      driveFileId: latestFile.id,
    });

    // 6. Log the cron run result
    console.log(`[Cron Import] File: ${latestFile.name}, Mode: ${result.mode}, Status: ${result.summary?.dismissalRisk || "ok"}`);

    return NextResponse.json({
      ok: true,
      fileName: latestFile.name,
      fileId: latestFile.id,
      modifiedTime: latestFile.modifiedTime,
      importResult: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    console.error(`[Cron Import Error] ${message}`);

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
