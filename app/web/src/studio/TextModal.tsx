import { useState } from "react";
import type { Template } from "../templates/schema";
import { BannerThumb } from "./BannerThumb";

export type CardText = { enabled: boolean; texts: Record<string, string> };

type Props = {
  template: Template;
  value: CardText;
  onSave: (v: CardText) => void;
  onClose: () => void;
};

/** Floating window to add text to one banner (default font + colors). */
export function TextModal({ template, value, onSave, onClose }: Props) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const el of template.elements) seed[el.key] = value.texts[el.key] ?? el.default;
    return seed;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add text — {template.name}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="check" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Add text to this banner when generating
        </label>

        <div className="modal-preview">
          <BannerThumb template={template} size="desktop" texts={texts} showText={enabled} />
        </div>

        <div className={enabled ? "" : "dimmed"}>
          {template.elements.map((el) => (
            <label key={el.key} className="f">
              <span className="field-label">{el.label}</span>
              <textarea
                rows={el.key === "subtitle" ? 2 : 1}
                value={texts[el.key] ?? ""}
                disabled={!enabled}
                onChange={(e) => setTexts({ ...texts, [el.key]: e.target.value })}
              />
            </label>
          ))}
          <p className="muted">
            Text uses this banner's default font ({template.defaultFont}) and colors.
          </p>
        </div>

        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave({ enabled, texts })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
