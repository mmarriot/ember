import { render } from "preact";
// The stylesheets, in cascade order: a later file's rule wins over an earlier one's of the same specificity.
import "./styles/base.css";
import "./styles/topbar.css";
import "./styles/start.css";
import "./styles/sidebar.css";
import "./styles/viewport.css";
import "./styles/inspector.css";
import "./styles/dialogs.css";
import "./styles/narrow.css";
import { App } from "./ui/App";

render(<App />, document.getElementById("app")!);
