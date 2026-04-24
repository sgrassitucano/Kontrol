import * as XLSX from "xlsx";

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

  const baseStyle = { font: { name: "Calibri", sz: 10 } };
  const headerStyle = { font: { name: "Calibri", sz: 10, bold: true } };

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ensureCell(ws, addr);
      cell.s = r === range.s.r ? headerStyle : baseStyle;
    }
  }
}

