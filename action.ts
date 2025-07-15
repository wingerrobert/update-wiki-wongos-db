import { updateArticles } from "./articleService";

(async () => {
  const count = await updateArticles();

  console.log(`Stored ${count} articles.`);
})().catch(err => { console.error("sync failed!", err); process.exit(1); });
