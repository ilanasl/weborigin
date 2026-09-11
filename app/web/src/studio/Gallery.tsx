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
import { BannerThumb } from "./BannerThumb";
import { TextModal, type CardText } from "./TextModal";

type CardState = { selected: boolean; mobile: boolean; text: CardText };
const emptyText: CardText = { enabled: false, texts: {} };
const defaultCard = (): CardState => ({ selected: false, mobile: false, text: { ...emptyText } });

export default function Gallery() {
  const [cards, setCards] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(templates.map((t) => [t.id, defaultCard()]))
  );
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
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
    if (topic.trim()) setBank(addTopic(topic));

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
        addLog(`⏳ ${t.name} — generating image…`);
        const promptText = [topic, customPrompt].filter((s) => s.trim()).join(". ");
        const prompt = buildBackgroundPrompt(
          promptText || t.background.defaultTopic || "clean background",
          aspectFromSize(t.sizes.desktop.w, t.sizes.desktop.h)
        );
        const url = await generateImage(prompt);
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

      <div className="run-panel">
        <div className="run-row">
          <label className="f grow">
            <span className="field-label">Image topic (applies to every banner)</span>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. a moving company — movers carrying boxes"
              list="topic-bank"
            />
            <datalist id="topic-bank">
              {bank.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
        </div>
        {bank.length > 0 && (
          <div className="chips">
            {bank.slice(0, 12).map((t) => (
              <button key={t} className="chip" onClick={() => setTopic(t)} title="Use this topic">
                {t}
              </button>
            ))}
          </div>
        )}
        <label className="f">
          <span className="field-label">Extra prompt (optional)</span>
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. warm daylight, photorealistic, no text on boxes"
          />
        </label>

        <div className="run-row wrap">
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
        <BannerThumb template={template} size="desktop" image={null} showText={false} />
      </div>

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
