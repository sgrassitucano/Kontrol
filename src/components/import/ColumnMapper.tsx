import { useState, useMemo } from "react";
import { PanelCard } from "@/components/module-ui";

export type ColumnMapping = Record<string, string | null>; // { colonna_A: "matricola", colonna_B: null, ... }

const EXPECTED_FIELDS = [
  { key: "matricola", label: "Matricola", required: true },
  { key: "data_nascita", label: "Data Nascita (DD/MM/YYYY)", required: false },
  { key: "cognome", label: "Cognome", required: true },
  { key: "nome", label: "Nome", required: true },
  { key: "codice_fiscale", label: "Codice Fiscale", required: false },
  { key: "data_visita", label: "Data Ultima Visita (DD/MM/YYYY)", required: false },
  { key: "visita_richiesta", label: "Visita Richiesta (SI/NO)", required: false },
  { key: "scadenza_visita", label: "Scadenza Visita (DD/MM/YYYY)", required: false },
  { key: "limitazioni", label: "Limitazioni", required: false },
  { key: "note", label: "Note", required: false },
];

type ColumnMapperProps = {
  fileHeaders: string[];
  onMappingComplete: (mapping: ColumnMapping) => void;
  onCancel: () => void;
};

export function ColumnMapper({ fileHeaders, onMappingComplete, onCancel }: ColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping>(
    Object.fromEntries(fileHeaders.map((h) => [h, null])),
  );

  const unmappedHeaders = useMemo(
    () => fileHeaders.filter((h) => !Object.values(mapping).includes(h)),
    [fileHeaders, mapping],
  );

  const missingRequired = useMemo(
    () =>
      EXPECTED_FIELDS.filter((f) => f.required && !Object.values(mapping).includes(f.key))
        .map((f) => f.label),
    [mapping],
  );

  const handleFieldSelect = (header: string, field: string | null) => {
    const newMapping = { ...mapping };
    // Remove field from other headers
    Object.keys(newMapping).forEach((k) => {
      if (newMapping[k] === field) {
        newMapping[k] = null;
      }
    });
    newMapping[header] = field;
    setMapping(newMapping);
  };

  const handleSubmit = () => {
    if (missingRequired.length === 0) {
      onMappingComplete(mapping);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-[var(--brand-panel)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden border border-[var(--brand-line)] max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-bold text-[var(--brand-ink)] mb-4">
            Mappa colonne da file
          </h2>

          <p className="text-sm text-slate-600 mb-6">
            Seleziona quale colonna del file corrisponde a quale campo del sistema. I campi marcati con <span className="text-red-600">*</span> sono obbligatori.
          </p>

          <div className="space-y-4 mb-6">
            {fileHeaders.map((header) => (
              <div key={header} className="border border-[var(--brand-line)] rounded-xl p-4">
                <div className="text-sm font-semibold text-[var(--brand-ink)] mb-2">
                  Colonna: <span className="font-mono text-slate-600">{header}</span>
                </div>
                <select
                  value={mapping[header] || ""}
                  onChange={(e) => handleFieldSelect(header, e.target.value || null)}
                  className="w-full rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                >
                  <option value="">-- Non mappata --</option>
                  {EXPECTED_FIELDS.map((field) => (
                    <option
                      key={field.key}
                      value={field.key}
                      disabled={mapping[header] !== field.key && Object.values(mapping).includes(field.key)}
                    >
                      {field.label} {field.required ? "*" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {missingRequired.length > 0 && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-semibold text-red-700 mb-2">Campi obbligatori mancanti:</p>
              <ul className="text-sm text-red-600 list-disc list-inside">
                {missingRequired.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </p>
          )}

          {unmappedHeaders.length > 0 && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-700">
                {unmappedHeaders.length} colonna(e) non mappata(e): verranno ignorate.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              data-soft="true"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={missingRequired.length > 0}
              className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Continua
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
