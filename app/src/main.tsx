import { render } from "preact";

import { App } from "./app.js";
import "./style.css";

const host = document.getElementById("app");
if (host === null) throw new Error("index.html has no #app element to mount into");
render(<App />, host);
