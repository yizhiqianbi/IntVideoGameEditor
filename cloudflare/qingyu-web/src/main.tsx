import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TavernApp from "../engine/src/components/dzmm/tavern-app";
import "../engine/cloudflare/dzmm-web/src/page.css";
import "./otome.css";
createRoot(document.getElementById("root")!).render(<StrictMode><TavernApp/></StrictMode>);
