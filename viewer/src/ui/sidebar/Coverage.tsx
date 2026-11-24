// The truth coverage of the bundle (Metadata tab, docs/viewer.md): what the truth graph says about each kind drawn,
// folded to one line of counts.
import type { Match } from "../../io/format";
import { percent, TARGETS, type TruthStatus } from "../../model/truth/match";
import { bundle, modes, truthName, truthStatuses } from "../../model/store";
import { Info } from "../common/Info";
import { GapLink } from "../card/TruthBlock";

/** What a match counts, for "clean from 50% of its energy". */
export const counted = (m: Match) => (m.measure === "hits" ? "hits" : m.measure === "pt2" ? "tracks' pT²" : "energy");

/** What the truth graph says about each kind drawn from this bundle (docs/truth.md "Where truth stops"). */
export function Coverage() {
  const b = bundle.value,
    statuses = truthStatuses.value;
  if (!b || !modes.value.roots.truth) return null;
  const seen = new Set<string>(),
    rows: [string, TruthStatus][] = [];
  for (const d of b.header.display) {
    const s = statuses.get(d.table),
      kind = truthName(d.table);
    if (!s || d.context || seen.has(kind)) continue;
    seen.add(kind);
    rows.push([kind, s]);
  }
  const what = (s: TruthStatus) =>
    s.kind === "match"
      ? [
          `matched by CMSSW`,
          `${s.match.target ? `reconstruct ${TARGETS[s.match.target]}; ` : ""}clean from ${percent(s.match.good)} of its ${counted(s.match)}${s.match.in ? ` (${s.match.in})` : ""}`,
        ]
      : s.kind === "fact"
        ? [
            "truth fact",
            `simulated energy per particle in each hit${s.in ? ` (${s.in})` : ""}${s.unit ? `, recorded per ${typeof s.unit === "string" ? s.unit : Object.values(s.unit.names).join(", ")}` : ""}`,
          ]
        : s.kind === "container"
          ? ["with what contains it", "no truth of its own: drawn in the colour of the object it belongs to"]
          : ["no CMSSW associator", s.reason];
  // Folded to one line of counts: "7 matched · 9 no associator".
  const counts = (["match", "fact", "container", "none"] as const)
    .map((k) => [k, rows.filter(([, st]) => st.kind === k).length] as const)
    .filter(([, n]) => n);
  const SHORT = { match: "matched", fact: "truth fact", container: "via container", none: "no associator" };
  return (
    <section class="coverage fold">
      <details>
        <summary>
          <h3>Truth coverage</h3>{" "}
          <span class="count">
            {counts.map(([k, n]) => `${n} ${SHORT[k]}${k === "fact" && n > 1 ? "s" : ""}`).join(" · ")}
          </span>
        </summary>
        <p class="hint">
          What the truth graph says about each kind: matched by CMSSW's associator, or a truth fact (the simulated
          energy each particle left in its hits). Where it has no answer, Ember builds none: the reason is listed, and
          its gap in the truth-graph notes behind the i.
        </p>
        <ul class="coverage">
          {rows.map(([kind, s]) => {
            const [word, detail] = what(s),
              why = s.kind === "none";
            return (
              <li class={s.kind === "none" ? "none" : undefined} title={detail}>
                <span class="kindname">{kind}</span> {word}
                {why && <span class="muted">: {detail}</span>}
                {s.kind === "none" && s.gap !== undefined && (
                  <Info title={`${kind}: no associator`}>
                    <p>
                      <GapLink gap={s.gap} />
                    </p>
                  </Info>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
