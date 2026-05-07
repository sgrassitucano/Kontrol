import * as XLSX from "xlsx-js-style";

function ensureCell(ws: XLSX.WorkSheet, addr: string) {
  const cell = ws[addr];
  if (cell) return cell;
  const created: XLSX.CellObject = { t: "s", v: "" };
  ws[addr] = created;
  return created;
}

export function applyCalibri10WithBoldHeader(ws: XLSX.WorkSheet) {
  const ref = ws["!ref"];
  if (!ref) return;

  const range = XLSX.utils.decode_range(ref);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ensureCell(ws, addr);
      const isHeader = r === range.s.r;
      const existingStyle = (cell.s ?? {}) as Record<string, unknown>;
      const existingFont = (existingStyle.font ?? {}) as Record<string, unknown>;
      cell.s = {
        ...existingStyle,
        font: {
          ...existingFont,
          name: "Calibri",
          sz: 9,
          bold: isHeader ? true : false,
        },
      };
    }
  }

  const colMax = Array.from({ length: range.e.c - range.s.c + 1 }, () => 0);
  const rowMaxLines = Array.from({ length: range.e.r - range.s.r + 1 }, () => 1);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      const raw = cell?.v;
      if (raw === null || typeof raw === "undefined") continue;
      const text = String(raw);
      if (!text) continue;

      const colIdx = c - range.s.c;
      const rowIdx = r - range.s.r;

      const lines = text.split(/\r?\n/);
      rowMaxLines[rowIdx] = Math.max(rowMaxLines[rowIdx] ?? 1, lines.length);

      for (const line of lines) {
        colMax[colIdx] = Math.max(colMax[colIdx] ?? 0, line.length);
      }
    }
  }

  ws["!cols"] = colMax.map((len) => ({
    wch: Math.min(Math.max(len + 2, 8), 70),
  }));

  ws["!rows"] = rowMaxLines.map((lines, idx) => ({
    hpt: idx === 0 ? 14 : Math.min(12 * Math.max(lines, 1), 60),
  }));
}
