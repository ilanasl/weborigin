import { useEffect, useMemo, useState } from "react";
import { templates } from "../templates";
import type { Template } from "../templates/schema";
import { generateImage, checkHealth } from "../lib/imageApi";
import { buildBackgroundPrompt, aspectFromSize } from "../lib/promptBuilder";
import { loadImage } from "../lib/images";
import { ensureFontReady } from "../lib/fonts";
import { renderBanner } from "../lib/render";
import {
  encodeCanvas,
  blobToDataUrl,
  downloadBlob,
  EXT,
  type ExportFormat,
} from "../lib/encode";
import { saveToFolder, getOutputDir } from "../lib/saveApi";
import { getTopics, addTopic } from "../lib/topics";
import { fileToDataUrl } from "../lib/file";
import { BannerThumb } from "./BannerThumb";
import { TextModal, type CardText } from "./TextModal";

type CardState = {
  selected: boolean;
  mobile: boolean;
  topic: string;
  customPrompt: string;
  uploadedImage?: string; // if set, use this instead of AI generation
  text: CardText;
};
const emptyText: CardText = { enabled: false, texts: {} };
const defaultCard = (): CardState => ({
  selected: false,
  mobile: false,
  topic: "",
  customPrompt: "",
  uploadedImage: undefined,
  text: { ...emptyText },
});

export default function Gallery() {
  const [cards, setCards] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(templates.map((t) => [t.id, defaultCard()]))
  );
  const [bank, setBank] = useState<string[]>(() => getTopics());
  const [format, setFormat] = useState<ExportFormat>("png");
  const [limitOn, setLimitOn] = useState(false);
  const [targetKB, setTargetKB] = useState(150);
  const [modalFor, setModalFor] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [outDir, setOutDir] = useState("");

  useEffect(() => {
    checkHealth().then((h) => setHasKey(h.hasKey));
    getOutputDir().then(setOutDir);
  }, []);

  const selectedCount = useMemo(
    () => templates.filter((t) => cards[t.id]?.selected).length,
    [cards]
  );

  function patch(id: string, p: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }
  function setAll(selected: boolean) {
    setCards((prev) =>
      Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, selected }]))
    );
  }
  function resetAll() {
    setCards(Object.fromEntries(templates.map((t) => [t.id, defaultCard()])));
  }

  async function runAll() {
    const chosen = templates.filter((t) => cards[t.id]?.selected);
    if (!chosen.length) return;
    // Remember every topic typed for a selected banner.
    let nextBank = bank;
    for (const t of chosen) {
      const tp = cards[t.id].topic.trim();
      if (tp) nextBank = addTopic(tp);
    }
    setBank(nextBank);

    setRunning(true);
    setLog([]);
    let total = 0;
    for (const t of chosen) total += cards[t.id].mobile ? 2 : 1;
    setProgress({ done: 0, total });
    let done = 0;
    const addLog = (line: string) => setLog((l) => [...l, line]);

    for (const t of chosen) {
      const card = cards[t.id];
      try {
        let url: string;
        if (card.uploadedImage) {
          addLog(`🖼 ${t.name} — using your uploaded image…`);
          url = card.uploadedImage;
        } else {
          addLog(`⏳ ${t.name} — generating image…`);
          const promptText = [card.topic, card.customPrompt].filter((s) => s.trim()).join(". ");
          const prompt = buildBackgroundPrompt(
            promptText || t.background.defaultTopic || "clean background",
            aspectFromSize(t.sizes.desktop.w, t.sizes.desktop.h)
          );
          url = await generateImage(prompt);
        }
        const img = await loadImage(url);
        await ensureFontReady(t.defaultFont);

        const sizes: ("desktop" | "mobile")[] = card.mobile ? ["desktop", "mobile"] : ["desktop"];
        for (const size of sizes) {
          const canvas = renderBanner({
            template: t,
            size,
            image: img,
            texts: card.text.enabled ? card.text.texts : {},
            showText: card.text.enabled,
          });
          const blob = await encodeCanvas(canvas, {
            format,
            targetKB: limitOn && format !== "png" ? targetKB : undefined,
            background: t.background.color || "#ffffff",
          });
          const name = `${t.id}-${size}.${EXT[format]}`;
          try {
            await saveToFolder(name, await blobToDataUrl(blob));
            addLog(`✓ Saved ${name} (${Math.round(blob.size / 1024)} KB)`);
          } catch {
            downloadBlob(blob, name);
            addLog(`↓ Downloaded ${name} (${Math.round(blob.size / 1024)} KB)`);
          }
          done++;
          setProgress({ done, total });
        }
      } catch (err: any) {
        addLog(`✗ ${t.name}: ${err?.message || "failed"}`);
        done += card.mobile ? 2 : 1;
        setProgress({ done, total });
      }
    }
    addLog("Done.");
    setRunning(false);
  }

  const modalTemplate = modalFor ? templates.find((t) => t.id === modalFor) : null;

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">Banner Studio</div>
        <span className="muted">{templates.length} banner types</span>
        <span style={{ flex: 1 }} />
        {hasKey === false && <span className="warn">No API key — add server/.env for AI images</span>}
      </header>

      {/* Shared bank of remembered topics — each card's topic input reads from it */}
      <datalist id="topic-bank">
        {bank.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="run-panel">
        <div className="run-row wrap">
          <span className="muted" style={{ marginRight: "auto" }}>
            Set a topic under each banner, tick the ones to generate, then Run all.
          </span>
          <label className="f">
            <span className="field-label">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label className={`f ${format === "png" ? "dimmed" : ""}`}>
            <span className="field-label">
              <input
                type="checkbox"
                checked={limitOn}
                disabled={format === "png"}
                onChange={(e) => setLimitOn(e.target.checked)}
              />{" "}
              Target weight (KB)
            </span>
            <input
              type="number"
              value={targetKB}
              disabled={format === "png" || !limitOn}
              onChange={(e) => setTargetKB(Number(e.target.value))}
            />
          </label>
          <div className="run-actions">
            <button className="ghost" onClick={() => setAll(true)}>
              Select all
            </button>
            <button className="ghost" onClick={() => setAll(false)}>
              Clear
            </button>
            <button className="ghost" onClick={resetAll}>
              Reset all
            </button>
            <button className="primary big" onClick={runAll} disabled={running || selectedCount === 0}>
              {running
                ? `Running ${progress.done}/${progress.total}…`
                : `Run all (${selectedCount})`}
            </button>
          </div>
        </div>
        {outDir && (
          <p className="muted">
            Saves to: <code>{outDir}</code> (change with OUTPUT_DIR in server/.env)
          </p>
        )}
      </div>

      <div className="grid">
        {templates.map((t) => (
          <Card
            key={t.id}
            template={t}
            state={cards[t.id]}
            onPatch={(p) => patch(t.id, p)}
            onText={() => setModalFor(t.id)}
            onReset={() => patch(t.id, defaultCard())}
          />
        ))}
      </div>

      {log.length > 0 && (
        <div className="run-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {modalTemplate && (
        <TextModal
          template={modalTemplate}
          value={cards[modalTemplate.id].text}
          onClose={() => setModalFor(null)}
          onSave={(v) => {
            patch(modalTemplate.id, { text: v });
            setModalFor(null);
          }}
        />
      )}
    </div>
  );
}

function Card({
  template,
  state,
  onPatch,
  onText,
  onReset,
}: {
  template: Template;
  state: CardState;
  onPatch: (p: Partial<CardState>) => void;
  onText: () => void;
  onReset: () => void;
}) {
  const d = template.sizes.desktop;
  return (
    <div className={`gcard ${state.selected ? "sel" : ""}`}>
      <label className="gcard-select">
        <input
          type="checkbox"
          checked={state.selected}
          onChange={(e) => onPatch({ selected: e.target.checked })}
        />
        <span className="gcard-title">
          {d.w}×{d.h}
        </span>
        <span className="muted gcard-name">{template.name}</span>
      </label>

      <div className="gcard-thumb" onClick={() => onPatch({ selected: !state.selected })}>
        <BannerThumb
          template={template}
          size="desktop"
          imageSrc={state.uploadedImage ?? null}
          showText={false}
        />
      </div>

      <div className="src-row">
        <span className="field-label">
          Image source: <b>{state.uploadedImage ? "your upload" : "AI from topic"}</b>
        </span>
        <label className="upload-mini">
          {state.uploadedImage ? "Replace" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onPatch({ uploadedImage: await fileToDataUrl(f) });
              e.currentTarget.value = "";
            }}
          />
        </label>
        {state.uploadedImage && (
          <button className="tiny" onClick={() => onPatch({ uploadedImage: undefined })}>
            Use AI
          </button>
        )}
      </div>

      <label className="f" style={{ opacity: state.uploadedImage ? 0.5 : 1 }}>
        <span className="field-label">Image topic (for AI)</span>
        <input
          type="text"
          list="topic-bank"
          value={state.topic}
          disabled={!!state.uploadedImage}
          onChange={(e) => onPatch({ topic: e.target.value })}
          placeholder={template.background.defaultTopic || "e.g. moving company"}
        />
      </label>
      <label className="f" style={{ opacity: state.uploadedImage ? 0.5 : 1 }}>
        <span className="field-label">Extra prompt (optional)</span>
        <input
          type="text"
          value={state.customPrompt}
          disabled={!!state.uploadedImage}
          onChange={(e) => onPatch({ customPrompt: e.target.value })}
          placeholder="e.g. warm daylight, no text"
        />
      </label>

      <div className="gcard-actions">
        <label className="check sm">
          <input
            type="checkbox"
            checked={state.mobile}
            onChange={(e) => onPatch({ mobile: e.target.checked })}
          />
          Mobile ({template.sizes.mobile.w}×{template.sizes.mobile.h})
        </label>
        <div className="gcard-btns">
          <button className={`tiny ${state.text.enabled ? "on" : ""}`} onClick={onText}>
            {state.text.enabled ? "Text ✓" : "Text"}
          </button>
          <button className="tiny" onClick={onReset} title="Reset to defaults">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
