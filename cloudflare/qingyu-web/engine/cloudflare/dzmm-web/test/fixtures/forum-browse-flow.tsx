/** Actual product component. Browser interception answers every API with original test posts. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ForumView from "../../../../src/components/dzmm/forum-view";
import styles from "../../../../src/components/dzmm/tavern.module.css";
import "../../src/page.css";

const OWNER = "28282828-2828-4282-8282-282828282828";
function currentPost() { return /^#forum\/post\/(.+)$/.exec(location.hash)?.[1]; }
function Fixture() {
  const [postId, setPostId] = useState(currentPost);
  useEffect(() => {
    const changed = () => setPostId(currentPost());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return <div className={styles.app}><ForumView userId={OWNER} isGuest={false} nickname="原创论坛旅人"
    postId={postId} onPostChange={id => { setPostId(id ?? undefined); location.hash = id ? `forum/post/${id}` : "forum"; }}
    characters={[]} onCharacter={() => { throw Error("No character navigation in this isolated flow"); }}
    onRequireAccount={() => { throw Error("No real authentication in this isolated flow"); }} /></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
