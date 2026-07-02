import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requireModuleAccess } from "@/lib/api/access";
import { buildShiftImages } from "@/lib/turni/shift-images";

export const runtime = "nodejs";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 24;

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const result = await buildShiftImages(auth.supabase, url);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (result.items.length === 0) {
      return NextResponse.json({ error: "Nessun turno trovato per la selezione." }, { status: 400 });
    }

    const doc = await PDFDocument.create();
    const maxW = A4.w - MARGIN * 2;
    const maxH = A4.h - MARGIN * 2;

    for (const item of result.items) {
      const png = await doc.embedPng(item.png);
      const scale = Math.min(maxW / png.width, maxH / png.height, 1);
      const w = png.width * scale;
      const h = png.height * scale;
      const page = doc.addPage([A4.w, A4.h]);
      page.drawImage(png, {
        x: (A4.w - w) / 2,
        y: A4.h - MARGIN - h,
        width: w,
        height: h,
      });
    }

    const bytes = await doc.save();
    const fileName = `turni_${result.mode}_${result.labelRange}.pdf`;

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Exported-Count": String(result.items.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore export PDF." },
      { status: 500 },
    );
  }
}
