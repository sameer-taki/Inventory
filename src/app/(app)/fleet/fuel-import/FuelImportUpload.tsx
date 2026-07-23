"use client";

import { useActionState, useState } from "react";
import { createFuelImportAction, type ActionState } from "../actions";

type ParsedRow = {
  fleet_code: string;
  filled_at: string;
  litres: string;
  cost_fjd: string;
  meter_reading: string;
};

// Minimal CSV parse: header row maps columns by name. No quoted-comma handling
// (statements are simple) — unknown columns are ignored.
function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const iCode = idx("fleet_code");
  const iDate = idx("filled_at");
  const iLitres = idx("litres");
  const iCost = idx("cost_fjd");
  const iMeter = idx("meter_reading");
  return lines.slice(1).map((line) => {
    const c = line.split(",").map((x) => x.trim());
    return {
      fleet_code: iCode >= 0 ? c[iCode] ?? "" : "",
      filled_at: iDate >= 0 ? c[iDate] ?? "" : "",
      litres: iLitres >= 0 ? c[iLitres] ?? "" : "",
      cost_fjd: iCost >= 0 ? c[iCost] ?? "" : "",
      meter_reading: iMeter >= 0 ? c[iMeter] ?? "" : "",
    };
  });
}

export function FuelImportUpload() {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createFuelImportAction,
    undefined,
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0)
        setParseError("No data rows found. Expected a header row with fleet_code, filled_at, litres, cost_fjd, meter_reading.");
      setRows(parsed);
    } catch {
      setParseError("Could not read the file.");
    }
  }

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-700">Upload fuel statement (CSV)</h2>
      <p className="text-xs text-slate-400">
        Columns: <code>fleet_code, filled_at, litres, cost_fjd, meter_reading</code>.
        Rows are staged for verification — nothing enters analytics until accepted.
      </p>
      <div>
        <label className="label" htmlFor="source_name">Statement name *</label>
        <input id="source_name" name="source_name" required className="field" placeholder="Total card stmt Jul-26" />
      </div>
      <div>
        <label className="label" htmlFor="file">CSV file</label>
        <input id="file" type="file" accept=".csv,text/csv" onChange={onFile} className="field" />
      </div>
      <input type="hidden" name="file_ref" value={fileName} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      {parseError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{parseError}</p>
      )}
      {rows.length > 0 && (
        <p className="text-sm text-slate-600">
          Parsed <span className="font-medium">{rows.length}</span> row(s) — ready to stage.
        </p>
      )}
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <button type="submit" className="btn-primary" disabled={pending || rows.length === 0}>
        {pending ? "Staging…" : "Stage for verification"}
      </button>
    </form>
  );
}
