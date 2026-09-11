import { useState } from "react";
import type { ExportFormat, ExportResult } from "../lib/exporter";

type Props = {
  onExport: (
    which: "desktop" | "mobile",
    format: ExportFormat,
    targetKB?: number
  ) => Promise<ExportResult>;
  showMobile?: boolean;
};

export function ExportBar({ onExport, showMobile = true }: Props) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [limitOn, setLimitOn] = useState(false);
  const [targetKB, setTargetKB] = useState(150);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canLimit = format !== "png";

  async function run(which: "desktop" | "mobile") {
    setBusy(true);
    setStatus(null);
    try {
      const res = await onExport(
        which,
        format,
        canLimit && limitOn ? targetKB : undefined
      );
      const kb = Math.round(res.bytes / 1024);
      setStatus(`Saved ${res.filename} — ${kb} KB`);
    } catch (e: any) {
      setStatus(e?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Export</h3>
      <label className="field">
        <span className="field-label">Format</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
        >
          <option value="png">PNG (lossless, transparent)</option>
          <option value="jpeg">JPG (small, no transparency)</option>
          <option value="webp">WebP (smallest)</option>
        </select>
      </label>

      <label className={`field checkbox ${canLimit ? "" : "disabled"}`}>
        <input
          type="checkbox"
          checked={limitOn}
          disabled={!canLimit}
          onChange={(e) => setLimitOn(e.target.checked)}
        />
        <span>Target file weight</span>
        <input
          type="number"
          min={20}
          max={5000}
          value={targetKB}
          disabled={!canLimit || !limitOn}
          onChange={(e) => setTargetKB(Number(e.target.value))}
          style={{ width: 80 }}
        />
        <span className="muted">KB</span>
      </label>
      {!canLimit && (
        <p className="muted">PNG is lossless — pick JPG or WebP to target a weight.</p>
      )}

      <div className="row">
        <button onClick={() => run("desktop")} disabled={busy}>
          Download desktop
        </button>
        {showMobile && (
          <button onClick={() => run("mobile")} disabled={busy}>
            Download mobile
          </button>
        )}
      </div>
      {status && <p className="status">{status}</p>}
    </div>
  );
}
