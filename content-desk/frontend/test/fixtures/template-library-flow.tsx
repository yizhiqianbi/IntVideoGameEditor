/** Actual studio, original synthetic account. Browser handlers isolate all APIs. */
import { createRoot } from "react-dom/client";
import GenerationStudio from "../../../shared/components/shelf/generation-studio";
import styles from "../../../shared/components/shelf/tavern.module.css";
import "../shared/page.css";
createRoot(document.getElementById("root")!).render(<div className={styles.app}><GenerationStudio
  userId="29292929-2929-4292-8292-292929292929" isGuest={false}
  onRequireAccount={() => { throw Error("No real authentication in isolated template test"); }}
  onRecharge={() => { throw Error("No real recharge in isolated template test"); }}/></div>);
