import { renderFolioPaymentInfoPage, type FolioPaymentInfoPage } from "../../shared/lib/folio-payment-info";
import "../../shared/components/shelf/community-guidelines.css";

export default function PaymentInfoPage({ page }: { page: FolioPaymentInfoPage }) {
  return <div dangerouslySetInnerHTML={{ __html: renderFolioPaymentInfoPage(page) }} />;
}
