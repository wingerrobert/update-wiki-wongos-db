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
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const DAYS_TO_FETCH = 10;

type WikiArticle =
  {
    pageid: string;
    normalizedtitle: string;
    description?: string;
    timestamp?: string;
    categories?: string[];
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

    const categories = await getCategories(article.normalizedtitle);

    const docRef = adminDb.doc(`articles/${article.pageid}`);
    batch.set(docRef, { ...article, categories, cachedAt: Timestamp.now() });

    storedCount++;
  }

  await batch.commit();
  return storedCount;
}

async function getCategories(title: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'categories',
    cllimit: 'max',
    clshow: '!hidden',
    format: 'json',
    origin: '*',
  });

  try {
    const res = await fetch(`${WIKI_API}?${params}`);
    const data = await res.json();

    const page = data.query?.pages?.[Object.keys(data.query.pages)[0]]?.categories ?? [];

    const categories: string[] = page
      .filter((c: any) => {
        const t = c.title.replace("Category:", "");
        return !t.toLowerCase().includes(title.toLowerCase());
      })
      .map((c: any) => c.title.replace("Category:", ""));

    return categories;
  } catch (error) {
    console.error(`Failed to fetch categories for "${title}":`, error);
    return [];
  }
}
async function getArticles() {
  let date = new Date();

  let currentIteration = 0;
  let articles: WikiArticle[] = [];

  for (let i = 0; i < DAYS_TO_FETCH; i++) {
    date.setMonth(date.getMonth() - i);
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
