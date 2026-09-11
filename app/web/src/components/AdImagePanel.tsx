import { useState } from "react";
import { generateImage, generateWithImages } from "../lib/imageApi";
import { buildAdPrompt } from "../lib/promptBuilder";
import { fileToDataUrl } from "../lib/file";
import { exportImageDataUrl, type ExportFormat } from "../lib/exporter";

const ASPECTS = ["1:1", "4:3", "3:2", "16:9", "3:1", "9:16"];

/** Standalone image generation for Google Ads — pure atmosphere images. */
export function AdImagePanel() {
  const [subject, setSubject] = useState(
    "a moving company: two movers carrying labeled boxes into a home, friendly and professional"
  );
  const [include, setInclude] = useState("");
  const [avoid, setAvoid] = useState("no text on the boxes or the truck");
  const [style, setStyle] = useState("photorealistic, warm natural light");
  const [aspect, setAspect] = useState("16:9");
  const [logo, setLogo] = useState<string | undefined>();
  const [placement, setPlacement] = useState("on the movers' t-shirts");

  const [image, setImage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [status, setStatus] = useState<string | null>(null);

  async function onGenerate() {
    setError(null);
    setBusy(true);
    try {
      const prompt = buildAdPrompt({
        subject,
        include,
        avoid,
        style,
        aspect,
        hasLogo: !!logo,
        logoPlacement: placement,
      });
      const dataUrl = logo
        ? await generateWithImages(prompt, [logo])
        : await generateImage(prompt);
      setImage(dataUrl);
    } catch (e: any) {
      setError(e?.message || "Failed to generate image.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (!image) return;
    setStatus(null);
    try {
      const res = await exportImageDataUrl(image, "ad-image", { format });
      setStatus(`Saved ${res.filename} — ${Math.round(res.bytes / 1024)} KB`);
    } catch (e: any) {
      setStatus(e?.message || "Export failed.");
    }
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="panel">
          <h3>Ad image</h3>
          <label className="field">
            <span className="field-label">Subject / scene</span>
            <textarea
              rows={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Must include (optional)</span>
            <input value={include} onChange={(e) => setInclude(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Avoid (what NOT to show)</span>
            <input value={avoid} onChange={(e) => setAvoid(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Style</span>
            <input value={style} onChange={(e) => setStyle(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Aspect ratio</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <h3>Logo placement (optional)</h3>
          <label className="upload-btn">
            {logo ? "Replace logo" : "Upload logo"}
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setLogo(await fileToDataUrl(f));
              }}
            />
          </label>
          {logo && (
            <label className="field">
              <span className="field-label">Where to place the logo</span>
              <input
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                placeholder="e.g. on the truck door, on a box, on the shirt"
              />
            </label>
          )}

          <div className="row">
            <button onClick={onGenerate} disabled={busy}>
              {busy ? "Generating…" : image ? "Regenerate" : "Generate image"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        {image && (
          <div className="panel">
            <h3>Download</h3>
            <label className="field">
              <span className="field-label">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <button onClick={onDownload}>Download image</button>
            {status && <p className="status">{status}</p>}
          </div>
        )}
      </aside>

      <main className="stage">
        {image ? (
          <img className="ad-preview" src={image} alt="generated ad" />
        ) : (
          <div className="empty">
            Describe a scene and generate a clean image for your Google ads.
            <br />
            No text or overlay is added — just the image.
          </div>
        )}
      </main>
    </div>
  );
}
