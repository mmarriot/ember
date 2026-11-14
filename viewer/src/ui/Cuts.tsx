// A cut group's minimum (e.g. the pT of jets): a chip on a kind's heading or a collection's row that names it, and in
// its pop-up a slider on a log scale with the exact value. A cut applies to every collection of its group.
import { computed } from "@preact/signals";
import type { DisplayLayer } from "../io/bundle";
import { cutGroups, cuts, event, labelOf, layerName, short } from "../model/store";
import { togglePopover } from "./Info";
import { Icon } from "./widgets";

/** Slider range per cut group, in log10: whole decades around the positive values of its layers in this event
 *  (at most 6 below the largest) and its default. The slider's lowest position means no cut. */
const sliderRanges = computed(() => {
  const ev = event.value,
    out = new Map<string, [number, number]>();
  for (const [name, g] of cutGroups.value) {
    let lo = g.default > 0 ? g.default : Infinity,
      hi = g.default > 0 ? g.default : 0;
    for (const d of g.layers) {
      const col = ev?.tables[d.table]?.columns[d.cut!.column];
      for (let i = 0; i < (col?.length ?? 0); i++) {
        const v = Number(col![i]);
        if (v > 0) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    const top = hi > 0 ? Math.ceil(Math.log10(hi)) : 2,
      bottom = hi > 0 ? Math.max(Math.floor(Math.log10(lo)), top - 6) : -4;
    out.set(name, [Math.min(bottom, top - 1), top]);
  }
  return out;
});

/** A cut group's minimum as one chip, "pT ≥ 30 GeV" ("no cut" at 0; marked when it is not the profile's): a click
 *  opens its slider in a pop-up. */
export function CutChip({ name, here }: { name: string; here: DisplayLayer[] }) {
  const g = cutGroups.value.get(name);
  if (!g) return null;
  const cut = g.layers[0].cut!,
    v = cuts.value[name] ?? g.default,
    what = cut.label ?? cut.column;
  return (
    <button
      class={v !== g.default ? "cutchip changed" : "cutchip"}
      title={`${name}: the minimum drawn. Click to change it`}
      onClick={(e) => togglePopover(e, () => <CutRow name={name} here={here} />, name, true)}
    >
      {v > 0 ? `${what} ≥ ${short(v)}${g.unit ? ` ${g.unit}` : ""}` : `no ${what} cut`}
    </button>
  );
}

/** A cut group's minimum (in the pop-up of its chip): log slider and exact value, labelled by its `label` or the
 *  column it cuts. It applies to every layer of the group, also those listed elsewhere (named under it). */
function CutRow({ name, here }: { name: string; here: DisplayLayer[] }) {
  const g = cutGroups.value.get(name);
  if (!g) return null;
  const cut = g.layers[0].cut!,
    v = cuts.value[name] ?? g.default,
    [lo, hi] = sliderRanges.value.get(name) ?? [-4, 2];
  const set = (x: number) => (cuts.value = { ...cuts.value, [name]: Math.max(0, x) });
  const toSlider = (x: number) => (x > 0 ? Math.log10(x) : lo),
    fromSlider = (s: number) => (s <= lo ? 0 : 10 ** s);
  const elsewhere = g.layers.filter((d) => !here.includes(d));
  return (
    <div class="cut" title={`Minimum ${name.toLowerCase()} for ${g.layers.map(layerName).join(", ")}`}>
      <div class="cutrow">
        <span class="cutname">{cut.label ?? cut.column} ≥</span>
        <input
          type="range"
          aria-label={name}
          min={lo}
          max={hi}
          step={0.01}
          value={toSlider(v)}
          onInput={(e) => set(fromSlider(Number((e.target as HTMLInputElement).value)))}
        />
        <input
          type="number"
          class="cutvalue"
          min={0}
          step="any"
          value={short(v)}
          onChange={(e) => set(Number((e.target as HTMLInputElement).value))}
        />
        <span class="muted unit">{g.unit}</span>
        {v !== g.default && (
          <button class="icon-button small" title={`Reset to ${g.default} ${g.unit}`} onClick={() => set(g.default)}>
            <Icon name="reset" />
          </button>
        )}
      </div>
      {elsewhere.length > 0 && (
        <div class="sub muted">also cuts {elsewhere.map((d) => labelOf(d.table)).join(", ")}</div>
      )}
    </div>
  );
}
