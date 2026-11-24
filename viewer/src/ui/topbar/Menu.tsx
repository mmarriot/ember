// The top bar's menu: every control in one place, grouped, with its key and whether it is on. Many have no button
// of their own (labels, replay, next object, levels).
import { signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  anchor,
  bundle,
  colourChoice,
  dialog,
  focus,
  focusBar,
  focusHistory,
  highlight,
  labelsOn,
  rest,
  selection,
  setRest,
  stepEvent,
  stepFocusLevel,
  touring,
  truthColours,
  view,
} from "../../model/store";
import { back, cross, frameFocus, nextDomain, nextObject, showWhole } from "../../control/navigate";
import { stopTour, toggleTour } from "../../control/tour";
import { replayEvent } from "../../control/scene";
import { hasDomainBar, REST_NAMES, VIEWS } from "../viewport/ViewControls";
import { Icon, usePressOutside } from "../common/widgets";
import { clusterSources, showUnclustered } from "../../model/event/clustered";

/** Whether the menu is open (Esc closes it: App.tsx). */
export const menuOpen = signal(false);

type Item = { label: string; keys?: string; on?: boolean; off?: boolean; run: () => void };

export function Menu() {
  const ref = useRef<HTMLDivElement>(null),
    open = menuOpen.value;
  usePressOutside(ref, open, () => (menuOpen.value = false));

  const parts = hasDomainBar(bundle.value?.header),
    f = focus.value,
    hits = !!bundle.value && clusterSources(bundle.value.header).size > 0; // a hit table that clusters list
  const levels = !!f && focusBar.value.some((l) => !l.always);
  const groups: [string, Item[]][] = [
    [
      "View",
      [
        ...VIEWS.map(
          ([v, name, key]): Item => ({ label: name, keys: key, on: view.value === v, run: () => (view.value = v) }),
        ),
        { label: "Show the whole event", keys: "Home", run: () => showWhole() },
        {
          label: "Zoom to the selection",
          keys: "F",
          off: !highlight.value,
          run: () => frameFocus(),
        },
        { label: "Labels", keys: "L", on: labelsOn.value, run: () => (labelsOn.value = !labelsOn.value) },
        ...(hits
          ? [
              {
                label: "Unclustered hits",
                on: showUnclustered.value,
                run: () => (showUnclustered.value = !showUnclustered.value),
              },
            ]
          : []),
        { label: "Save picture…", off: !bundle.value, run: () => (dialog.value = "picture") },
      ],
    ],
    [
      "Event",
      [
        { label: "Previous event", keys: "←", run: () => stepEvent(-1) },
        { label: "Next event", keys: "→", run: () => stepEvent(1) },
        ...(parts
          ? [
              { label: "Next part of the detector", keys: "D", run: () => nextDomain(1) },
              { label: "Previous part", keys: "⇧D", run: () => nextDomain(-1) },
            ]
          : []),
      ],
    ],
    [
      "Selection",
      [
        { label: "Next object, largest first", keys: "N", run: () => nextObject(1) },
        { label: "Previous object", keys: "⇧N", run: () => nextObject(-1) },
        { label: "Across to its truth or reco match", keys: "X", off: !selection.value, run: cross },
        {
          label: "Back to the previous object",
          keys: "B",
          off: !anchor.value && !focusHistory.value.length,
          run: back,
        },
        { label: `Others: ${REST_NAMES[rest.value][0]} (next)`, keys: "H", off: !f, run: () => setRest() },
        { label: "One level down", keys: "↓", off: !levels, run: () => stepFocusLevel(1) },
        { label: "One level up", keys: "↑", off: !levels, run: () => stepFocusLevel(-1) },
        {
          label: "Leave the selection",
          keys: "Esc",
          off: !selection.value,
          run: () => {
            selection.value = null;
            showWhole(true);
          },
        },
      ],
    ],
    [
      "Colours",
      truthColours.value
        ? [
            {
              label: "Reco: what was reconstructed",
              on: colourChoice.value === "reco",
              run: () => (colourChoice.value = "reco"),
            },
            {
              label: "Truth: what was really there",
              keys: "T",
              on: colourChoice.value === "truth",
              run: () => (colourChoice.value = "truth"),
            },
          ]
        : [],
    ],
    [
      "Play",
      [
        { label: "Replay the event, step by step", keys: "R", run: () => void replayEvent() },
        { label: "Tour, event after event", keys: "P", on: touring.value, run: toggleTour },
      ],
    ],
    ["", [{ label: "Help and every key", keys: "?", run: () => (dialog.value = "help") }]],
  ];
  return (
    <div class="menu" ref={ref}>
      <button
        class={open ? "icon-button menubutton on" : "icon-button menubutton"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        title="Menu: every control and its key"
        onClick={() => (menuOpen.value = !open)}
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div class="menupanel" role="menu">
          {groups
            .filter(([, items]) => items.length)
            .map(([name, items]) => (
              <div class="menugroup" role="group" aria-label={name || undefined}>
                {name && <div class="menuhead">{name}</div>}
                {items.map((it) => (
                  <button
                    role={it.on === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={it.on}
                    class={it.on ? "menuitem on" : "menuitem"}
                    disabled={it.off}
                    onClick={() => {
                      menuOpen.value = false;
                      if (it.run !== toggleTour) stopTour();
                      it.run();
                    }}
                  >
                    <span class="check" aria-hidden="true">
                      {it.on ? "✓" : ""}
                    </span>
                    <span class="what">{it.label}</span>
                    {it.keys && <kbd>{it.keys}</kbd>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
