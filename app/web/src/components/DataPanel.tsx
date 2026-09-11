import { useState } from "react";
import type { BannerValues, Template } from "../templates/schema";
import { generateImage } from "../lib/imageApi";
import { buildBackgroundPrompt, aspectFromSize } from "../lib/promptBuilder";
import { fileToDataUrl } from "../lib/file";

type Props = {
  template: Template;
  values: BannerValues;
  onChange: (patch: Partial<BannerValues>) => void;
};

/** The data-entry form. Fields are generated automatically from the template. */
export function DataPanel({ template, values, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setText = (key: string, v: string) =>
    onChange({ texts: { ...values.texts, [key]: v } });

  async function onGenerateBackground() {
    setError(null);
    setBusy(true);
    try {
      const aspect = aspectFromSize(
        template.sizes.desktop.w,
        template.sizes.desktop.h
      );
      const prompt = buildBackgroundPrompt(values.topic, aspect);
      const dataUrl = await generateImage(prompt);
      onChange({ backgroundImage: dataUrl });
    } catch (e: any) {
      setError(e?.message || "Failed to generate image.");
    } finally {
      setBusy(false);
    }
  }

  async function onUploadBackground(file?: File) {
    if (!file) return;
    onChange({ backgroundImage: await fileToDataUrl(file) });
  }

  async function onUploadLogo(file?: File) {
    if (!file) return;
    onChange({ logoImage: await fileToDataUrl(file) });
  }

  return (
    <div className="panel">
      <h3>Content</h3>
      {template.elements.map((el) => (
        <label key={el.key} className="field">
          <span className="field-label">{el.label}</span>
          {el.multiline ? (
            <textarea
              value={values.texts[el.key] ?? ""}
              onChange={(e) => setText(el.key, e.target.value)}
              rows={2}
            />
          ) : (
            <input
              type="text"
              value={values.texts[el.key] ?? ""}
              onChange={(e) => setText(el.key, e.target.value)}
            />
          )}
        </label>
      ))}

      <h3>Background image</h3>
      <label className="field">
        <span className="field-label">Image topic (for AI)</span>
        <textarea
          value={values.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
          rows={2}
          placeholder="e.g. cozy coffee shop interior, warm morning light"
        />
      </label>
      <div className="row">
        <button onClick={onGenerateBackground} disabled={busy}>
          {busy ? "Generating…" : "Generate with AI"}
        </button>
        <label className="upload-btn">
          Upload image
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onUploadBackground(e.target.files?.[0])}
          />
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      {template.logo?.enabled && template.logo.source === "upload" && (
        <>
          <h3>Logo</h3>
          <label className="upload-btn">
            {values.logoImage ? "Replace logo" : "Upload logo (PNG)"}
            <input
              type="file"
              accept="image/png,image/svg+xml,image/*"
              onChange={(e) => onUploadLogo(e.target.files?.[0])}
            />
          </label>
        </>
      )}

      <h3>Overlay</h3>
      <div className="row">
        <label className="field">
          <span className="field-label">Color</span>
          <input
            type="color"
            value={values.overlayColor}
            onChange={(e) => onChange({ overlayColor: e.target.value })}
          />
        </label>
        <label className="field grow">
          <span className="field-label">
            Strength ({Math.round(values.overlayOpacity * 100)}%)
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={values.overlayOpacity}
            onChange={(e) =>
              onChange({ overlayOpacity: Number(e.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}
