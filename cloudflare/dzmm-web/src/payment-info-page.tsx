import { renderXumengPaymentInfoPage, type XumengPaymentInfoPage } from "../../../src/lib/xumeng-payment-info";
import "../../../src/components/dzmm/community-guidelines.css";

export default function PaymentInfoPage({ page }: { page: XumengPaymentInfoPage }) {
  return <div dangerouslySetInnerHTML={{ __html: renderXumengPaymentInfoPage(page) }} />;
}
