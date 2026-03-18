import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>PencilStudio</p>
          <p className={styles.visionTag}>让创作变简单，人人都能做个游戏</p>
          <h1 className={styles.title}>把互动短剧、分支叙事和视频生成，收进一个真正能上手的 Studio。</h1>
          <p className={styles.description}>
            PencilStudio-VideoGame 想做的不是一个复杂后台，而是一块直接可创作的画布。你可以从故事出发，拆角色、放场景、排镜头、连分支，再把视频生成和导出接进同一条工作流里。
          </p>
          <div className={styles.actions}>
            <Link href="/pencil-studio-vid" className={styles.primaryLink}>
              进入 Vidu Studio
            </Link>
            <Link href="#products" className={styles.secondaryLink}>
              查看产品分栏
            </Link>
          </div>
        </div>

        <aside className={styles.heroPanel}>
          <p className={styles.panelLabel}>Vision</p>
          <div className={styles.panelQuote}>
            创作不该先学一堆工具。
            <br />
            先把故事讲出来，工具再跟上。
          </div>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <strong className={styles.metricValue}>角色</strong>
              <span className={styles.metricText}>统一参考图与形象设定</span>
            </div>
            <div className={styles.metricCard}>
              <strong className={styles.metricValue}>场景</strong>
              <span className={styles.metricText}>维持叙事空间与视觉一致性</span>
            </div>
            <div className={styles.metricCard}>
              <strong className={styles.metricValue}>分支</strong>
              <span className={styles.metricText}>把互动逻辑直接落进剧情树</span>
            </div>
          </div>
        </aside>
      </section>

      <section id="products" className={styles.productsSection}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Product</p>
          <h2 className={styles.sectionTitle}>产品分栏介绍</h2>
          <p className={styles.sectionDescription}>
            从故事规划到视频生成，再到导出交付，首页先把产品的三块核心能力讲清楚。
          </p>
        </div>

        <div className={styles.grid}>
          <article className={styles.card}>
            <p className={styles.cardEyebrow}>互动影游戏</p>
            <h3 className={styles.cardTitle}>把剧情树、角色卡和场景卡，直接拼成一个可互动的影视游戏</h3>
            <p className={styles.cardText}>
              用自上而下的树结构管理镜头节点、选择分支和过渡条件，让互动叙事从故事大纲直接变成可玩的体验。
            </p>
            <ul className={styles.featureList}>
              <li>角色、场景、镜头在同一画布里协作</li>
              <li>互动选项直接挂在剧情树上</li>
              <li>适合短剧、AVG 和互动剧情原型</li>
            </ul>
          </article>

          <article className={styles.card}>
            <p className={styles.cardEyebrow}>游戏</p>
            <h3 className={styles.cardTitle}>从一个故事出发，继续搭角色逻辑、关卡节奏和分支结果</h3>
            <p className={styles.cardText}>
              不只是做镜头，还可以继续往游戏化结构延展，把互动分支、结果反馈和节点逻辑组织成真正可迭代的游戏内容。
            </p>
            <ul className={styles.featureList}>
              <li>分支推进和结果回收更清晰</li>
              <li>适合做章节化与多结局设计</li>
              <li>让剧情创作自然过渡到游戏制作</li>
            </ul>
            <Link href="/pencil-studio-vid" className={styles.cardLink}>
              打开 Studio
            </Link>
          </article>

          <article className={styles.card}>
            <p className={styles.cardEyebrow}>视频</p>
            <h3 className={styles.cardTitle}>把 AI 视频生成真正接进创作流程，而不是做完故事再额外找工具</h3>
            <p className={styles.cardText}>
              统一管理豆包、MiniMax、Vidu、Kling 等视频 provider，把生成、轮询、预览和结果回填收进同一个工作台。
            </p>
            <ul className={styles.featureList}>
              <li>图生视频与纯提示词生成</li>
              <li>节点内直接回看生成结果</li>
              <li>互动版和全路径版本都能导出</li>
            </ul>
          </article>
        </div>
      </section>

      <section className={styles.bottomBanner}>
        <p className={styles.bottomText}>
          愿景很简单：让更多人从“想做一个互动故事”直接走到“我真的做出了一个能玩的作品”。
        </p>
        <Link href="/pencil-studio-vid" className={styles.bottomLink}>
          现在进入 Studio
        </Link>
      </section>
    </main>
  );
}
