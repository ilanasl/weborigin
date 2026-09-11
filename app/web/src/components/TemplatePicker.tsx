import type { Template } from "../templates/schema";

type Props = {
  templates: Template[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function TemplatePicker({ templates, selectedId, onSelect }: Props) {
  return (
    <div className="template-list">
      {templates.map((t) => (
        <button
          key={t.id}
          className={`template-card ${t.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          <strong>{t.name}</strong>
          <small>
            {t.sizes.desktop.w}×{t.sizes.desktop.h} · {t.sizes.mobile.w}×
            {t.sizes.mobile.h}
          </small>
          {t.description && <span className="muted">{t.description}</span>}
        </button>
      ))}
    </div>
  );
}
