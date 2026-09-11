import { useEffect, useMemo, useRef, useState } from "react";
import { templates, getTemplate } from "./templates";
import {
  type BannerValues,
  type SizeKey,
  defaultValues,
} from "./templates/schema";
import { BannerCanvas } from "./components/BannerCanvas";
import { TemplatePicker } from "./components/TemplatePicker";
import { DataPanel } from "./components/DataPanel";
import { ExportBar } from "./components/ExportBar";
import { SizeToggle } from "./components/SizeToggle";
import { FontPicker } from "./components/FontPicker";
import { ModeSwitch, type Mode } from "./components/ModeSwitch";
import { AdImagePanel } from "./components/AdImagePanel";
import { exportBanner, type ExportFormat } from "./lib/exporter";
import { ensureFontReady } from "./lib/fonts";
import { checkHealth } from "./lib/imageApi";

const PREVIEW_MAX_W = 720;
const PREVIEW_MAX_H = 560;

export default function App() {
  const [mode, setMode] = useState<Mode>("banners");
  const [templateId, setTemplateId] = useState(templates[0].id);
  const template = getTemplate(templateId)!;

  // Keep separate values per template so switching doesn't lose work.
  const [valuesById, setValuesById] = useState<Record<string, BannerValues>>(
    () => ({ [templates[0].id]: defaultValues(templates[0]) })
  );
  const values =
    valuesById[templateId] ?? defaultValues(template);

  const [size, setSize] = useState<SizeKey>("desktop");
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  const desktopRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkHealth().then((h) => setHasKey(h.hasKey));
  }, []);

  useEffect(() => {
    ensureFontReady(values.fontFamily);
  }, [values.fontFamily]);

  function patch(p: Partial<BannerValues>) {
    setValuesById((prev) => ({
      ...prev,
      [templateId]: { ...(prev[templateId] ?? defaultValues(template)), ...p },
    }));
  }

  function selectTemplate(id: string) {
    setTemplateId(id);
    setValuesById((prev) =>
      prev[id] ? prev : { ...prev, [id]: defaultValues(getTemplate(id)!) }
    );
  }

  const dims = template.sizes[size];
  const scale = useMemo(
    () => Math.min(PREVIEW_MAX_W / dims.w, PREVIEW_MAX_H / dims.h, 1),
    [dims.w, dims.h]
  );

  async function handleExport(
    which: SizeKey,
    format: ExportFormat,
    targetKB?: number
  ) {
    await ensureFontReady(values.fontFamily);
    const node = which === "desktop" ? desktopRef.current : mobileRef.current;
    if (!node) throw new Error("Banner not ready.");
    const d = template.sizes[which];
    return exportBanner(node, d.w, d.h, `${template.id}-${which}`, {
      format,
      targetKB,
      background: template.background.color ?? "#ffffff",
    });
  }

  if (mode === "adImages") {
    return (
      <div className="app">
        <Header
          mode={mode}
          onMode={setMode}
          hasKey={hasKey}
        />
        <AdImagePanel />
      </div>
    );
  }

  return (
    <div className="app">
      <Header mode={mode} onMode={setMode} hasKey={hasKey} />

      <div className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <h3>Template</h3>
            <TemplatePicker
              templates={templates}
              selectedId={templateId}
              onSelect={selectTemplate}
            />
          </div>
          <div className="panel">
            <FontPicker
              value={values.fontFamily}
              onChange={(f) => patch({ fontFamily: f })}
            />
          </div>
          <DataPanel template={template} values={values} onChange={patch} />
          <ExportBar onExport={handleExport} />
        </aside>

        <main className="stage">
          <div className="stage-bar">
            <SizeToggle value={size} onChange={setSize} />
            <span className="muted">
              {dims.w} × {dims.h} px
            </span>
          </div>

          {/* Visible, scaled preview */}
          <div
            className="preview-frame"
            style={{ width: dims.w * scale, height: dims.h * scale }}
          >
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                width: dims.w,
                height: dims.h,
              }}
            >
              <BannerCanvas template={template} values={values} size={size} />
            </div>
          </div>
        </main>
      </div>

      {/* Off-screen full-size canvases used as the export source */}
      <div className="offscreen" aria-hidden="true">
        <BannerCanvas
          ref={desktopRef}
          template={template}
          values={values}
          size="desktop"
        />
        <BannerCanvas
          ref={mobileRef}
          template={template}
          values={values}
          size="mobile"
        />
      </div>
    </div>
  );
}

function Header({
  mode,
  onMode,
  hasKey,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  hasKey: boolean | null;
}) {
  return (
    <header className="topbar">
      <div className="brand">Banner Studio</div>
      <ModeSwitch value={mode} onChange={onMode} />
      {hasKey === false && (
        <span className="warn">
          No API key — add server/.env to enable AI images
        </span>
      )}
    </header>
  );
}
