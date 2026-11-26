// The viewer's state: the signals components read and the actions they call, gathered here so that a component
// imports them from one place. Signals (@preact/signals) hold values; a component or a computed that reads `.value`
// is run again when that value changes. By subject:
// - data.ts: the data set open and the event shown;
// - open.ts: the site's list of data sets, opening one, moving between its events;
// - view.ts: what the view draws and how (ticks, domain, cuts, preset), and the page around it (theme, messages);
// - names.ts: how tables, layers, objects and numbers are named;
// - colours.ts: the colour mode, and each kind's truth status;
// - selection.ts: the selection, the focus, its levels, the card's chain and the truth <-> reco pair;
// - truthView.ts: the Truth tab's graph: its levels, its controls, the particles picked in it.
export * from "./data";
export * from "./open";
export * from "./view";
export * from "./names";
export * from "./colours";
export * from "./selection";
export * from "./truthView";
