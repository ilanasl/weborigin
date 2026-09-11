import type { SizeKey } from "../templates/schema";

type Props = { value: SizeKey; onChange: (s: SizeKey) => void };

export function SizeToggle({ value, onChange }: Props) {
  return (
    <div className="toggle">
      <button
        className={value === "desktop" ? "active" : ""}
        onClick={() => onChange("desktop")}
      >
        Desktop
      </button>
      <button
        className={value === "mobile" ? "active" : ""}
        onClick={() => onChange("mobile")}
      >
        Mobile
      </button>
    </div>
  );
}
