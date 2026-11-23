// "Save picture…" (the menu): the view alone, without the page around it, as a PNG at 1x, 2x or 4x its size on
// screen, with the view's title as an optional caption. The engine draws it (render/engine.ts picture).
import { useState } from "preact/hooks";
import { dialog, shownEntry, toast } from "../model/store";
import { engine } from "../control/scene";
import { shownSummary, shownTitle } from "./TitleBox";
import { Modal } from "./widgets";

const SCALES = [1, 2, 4];

/** Write `lines` at the top left of the picture, on a panel of the page's surface colour with a border (the view's
 *  own background would not stand out from the view), at the picture's scale. */
function caption(c: HTMLCanvasElement, scale: number, lines: string[]) {
  const g = c.getContext("2d")!,
    css = getComputedStyle(document.documentElement),
    size = 13 * scale,
    pad = 8 * scale;
  g.font = `600 ${size}px system-ui, sans-serif`;
  g.textBaseline = "top";
  const width = Math.max(...lines.map((l) => g.measureText(l).width));
  const box: [number, number, number, number] = [pad, pad, width + 2 * pad, lines.length * size * 1.4 + pad];
  g.fillStyle = css.getPropertyValue("--surface");
  g.fillRect(...box);
  g.strokeStyle = css.getPropertyValue("--line-strong");
  g.lineWidth = scale;
  g.strokeRect(...box);
  g.fillStyle = css.getPropertyValue("--text");
  lines.forEach((l, i) => g.fillText(l, 2 * pad, pad * 1.5 + i * size * 1.4));
}

export function PictureDialog() {
  const [scale, setScale] = useState(2),
    [captioned, setCaptioned] = useState(true);
  const view = document.querySelector(".viewport canvas"),
    w = view?.clientWidth ?? 0,
    h = view?.clientHeight ?? 0;
  const lines = [shownTitle(), shownSummary()].filter(Boolean),
    e = shownEntry.value;
  const save = () => {
    const c = engine?.picture(scale);
    dialog.value = null;
    if (!c)
      return toast(`The graphics card cannot draw ${w * scale} × ${h * scale} pixels: choose a smaller size`, "error");
    if (captioned) caption(c, scale, lines);
    c.toBlob((blob) => {
      if (!blob) return toast("The picture could not be made", "error");
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: e ? `ember_${e.run}_${e.lumi}_${e.event}.png` : "ember.png",
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };
  return (
    <Modal title="Save picture">
      <p class="muted">The view alone, as it is now, without the side panel, the card, the labels or the axes.</p>
      <div class="segmented picture-size" role="group" aria-label="Size">
        {SCALES.map((s) => (
          <button class={scale === s ? "on" : ""} onClick={() => setScale(s)}>
            {s}× <small>{`${w * s} × ${h * s}`}</small>
          </button>
        ))}
      </div>
      <label class="picture-caption">
        <input type="checkbox" checked={captioned} onChange={() => setCaptioned(!captioned)} /> Caption:{" "}
        {lines.join(" · ") || "none"}
      </label>
      <button class="primary" onClick={save} disabled={!e}>
        Save as PNG
      </button>
    </Modal>
  );
}
