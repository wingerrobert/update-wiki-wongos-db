import { Timestamp } from "firebase-admin/firestore";
import { cert, initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });

const adminDb = getFirestore(app);

const MAX_ITERATIONS = 1000;
const RETRY_DELAY = 250; 
const FEED_API = 'https://api.wikimedia.org/feed/v1/wikipedia/en/featured';

type WikiArticle =
{
  pageid: string;
  normalizedtitle: string;
  description?: string;
  timestamp?: string;
  cachedAt: Timestamp;
};

export async function updateArticles(): Promise<number> {
  const articles: WikiArticle[] = await getArticles();
  let storedCount = 0;

  const batch = adminDb.batch();

  for (const article of articles) {
    const docid = article?.pageid?.toString();

    if (!docid) {
      console.warn("Missing pageid for article:", article);
      continue;
    }
    
    const docRef = adminDb.doc(`articles/${article.pageid}`);
    batch.set(docRef, { ...article, cachedAt: Timestamp.now() });

    storedCount++;
  }

  await batch.commit();
  return storedCount;
}

async function getArticles() {
  const date = new Date();

  let currentIteration = 0;
  let articles: WikiArticle[] = [];

  while (currentIteration++ < MAX_ITERATIONS) {
    try {
      const response = await fetch(`${FEED_API}/${date.toISOString().slice(0, 10).replace(/-/g, '/')}`);
      const data = await response.json();

      const tfaArticle = data.tfa && isWikiArticle(data.tfa) ? [data.tfa] : [];
      const mostReadArticles = (data.mostread?.articles ?? []).filter(isWikiArticle);
      const featuredArticles = (data.featured?.articles ?? []).filter(isWikiArticle);

      articles.push(...tfaArticle, ...mostReadArticles, ...featuredArticles);

      break;
    } catch (e) {
      await sleep(RETRY_DELAY ?? 300);
      console.error("Error grabbing articles for date:", date, e);
    }
  }

  return articles;
}

function isWikiArticle(obj: any): obj is WikiArticle {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.normalizedtitle === 'string'
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
