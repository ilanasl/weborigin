import { useEffect } from "react";
import { GOOGLE_FONTS, loadFont } from "../lib/fonts";

type Props = { value: string; onChange: (font: string) => void };

export function FontPicker({ value, onChange }: Props) {
  // Preload the fonts so the dropdown preview and canvas render correctly.
  useEffect(() => {
    GOOGLE_FONTS.forEach(loadFont);
  }, []);

  return (
    <label className="field">
      <span className="field-label">Font</span>
      <select
        value={value}
        onChange={(e) => {
          loadFont(e.target.value);
          onChange(e.target.value);
        }}
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        {GOOGLE_FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
}
