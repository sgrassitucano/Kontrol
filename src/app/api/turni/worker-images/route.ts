import { NextResponse } from "next/server";
import JSZip from "jszip";
import sharp from "sharp";
import { requireModuleAccess } from "@/lib/api/access";
import { buildShiftImages } from "@/lib/turni/shift-images";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "jpg").toLowerCase();

    const result = await buildShiftImages(auth.supabase, url);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const zip = new JSZip();
    let count = 0;

    for (const item of result.items) {
      const fileName = `${item.baseName}.${format === "png" ? "png" : "jpg"}`;
      const image = format === "png" ? item.png : await sharp(item.png).jpeg({ quality: 90 }).toBuffer();
      zip.file(fileName, image);
      count += 1;
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const body = new Uint8Array(buffer);
    const zipName = `turni_${result.mode}_${result.labelRange}.zip`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "X-Exported-Count": String(count),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore export immagini." },
      { status: 500 },
    );
  }
}
