export type Mode = "banners" | "adImages";

type Props = { value: Mode; onChange: (m: Mode) => void };

export function ModeSwitch({ value, onChange }: Props) {
  return (
    <div className="mode-switch">
      <button
        className={value === "banners" ? "active" : ""}
        onClick={() => onChange("banners")}
      >
        Banners
      </button>
      <button
        className={value === "adImages" ? "active" : ""}
        onClick={() => onChange("adImages")}
      >
        Ad Images
      </button>
    </div>
  );
}
