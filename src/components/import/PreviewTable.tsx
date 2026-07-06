type PreviewTableProps<T> = {
  title: string;
  rows: T[];
  columns: { key: keyof T; label: string }[];
  rowKey?: (row: T, index: number) => string;
  emptyMessage?: string;
};

export function PreviewTable<T>({
  title,
  rows,
  columns,
  rowKey = (_, i) => i.toString(),
  emptyMessage = "Nessuna anteprima disponibile.",
}: PreviewTableProps<T>) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
      <div className="border-b border-[var(--brand-line)] px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => (
                <th key={String(col.key)} className="px-4 py-3">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <tr key={rowKey(row, index)} className="border-t border-[var(--brand-line)]">
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-4 py-3 text-slate-600">
                      {String(row[col.key]) || "-"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}
