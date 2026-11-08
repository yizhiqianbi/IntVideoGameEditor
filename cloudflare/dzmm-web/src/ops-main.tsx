import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OpsShell from "@/components/dzmm/ops-shell";
import "./ops.css";

const container = document.getElementById("root");
if (!container) throw new Error("运营页缺少根容器。");
createRoot(container).render(<StrictMode><OpsShell /></StrictMode>);
