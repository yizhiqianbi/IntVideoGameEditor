import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TavernApp from "@/components/dzmm/tavern-app";
import { XUMENG_COMMUNITY_GUIDELINES_PATH } from "@/lib/xumeng-community-guidelines";
import { getXumengPaymentInfoPage } from "@/lib/xumeng-payment-info";
import PaymentInfoPage from "./payment-info-page";
import "./page.css";

const container = document.getElementById("root");
if (!container) throw new Error("叙梦页面缺少根容器。");

// Keep existing hash links and also support the deployed page's query links.
// The shared UI owns navigation after this initial, side-effect-free URL rewrite.
if (!window.location.hash) {
  const query = new URLSearchParams(window.location.search);
  const character = query.get("character");
  const view = query.get("view");
  const hash = character && /^[\w-]{1,120}$/.test(character)
    ? `#character/${character}`
    : view && ["characters", "chat", "profile"].includes(view)
      ? `#${view}`
      : "";
  if (hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
}

if (window.location.pathname.replace(/\/+$/, "") === XUMENG_COMMUNITY_GUIDELINES_PATH) {
  window.history.replaceState(null, "", "/");
}
const paymentInfoPage = getXumengPaymentInfoPage(window.location.pathname);
if (paymentInfoPage) document.title = paymentInfoPage.title;

createRoot(container).render(
  <StrictMode>
    {paymentInfoPage ? <PaymentInfoPage page={paymentInfoPage} /> : <TavernApp />}
  </StrictMode>,
);
