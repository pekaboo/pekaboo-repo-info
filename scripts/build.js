import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_META_PATH = path.join(__dirname, '../repo-meta.json');
const SAMPLE_DATA_PATH = path.join(__dirname, '../docs/_probe-sample.json');
const TEMPLATE_PATH = path.join(__dirname, '../templates/index.html');
const DIST_DIR = path.join(__dirname, '../dist');
const DIST_PATH = path.join(DIST_DIR, 'index.html');

// Helper to load Chart.js and return its string content
async function getChartJsContent() {
  const cachePath = path.join(__dirname, 'chart.min.js');
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf-8');
  }
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
    const content = await res.text();
    fs.writeFileSync(cachePath, content, 'utf-8');
    return content;
  } catch (err) {
    console.error('Failed to fetch Chart.js:', err.message);
    return '';
  }
}

// Aggregate commit dates into the last N weeks (index 0 = oldest). Snapshot-time fixed.
function aggregateWeeks(dates, weeksCount = 12) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = new Array(weeksCount).fill(0);
  const startBoundary = now - weeksCount * weekMs;
  for (const d of dates) {
    const t = new Date(d).getTime();
    if (Number.isNaN(t) || t < startBoundary) continue;
    const weeksAgo = Math.floor((now - t) / weekMs);
    const idx = weeksCount - 1 - weeksAgo;
    if (idx >= 0 && idx < weeksCount) buckets[idx]++;
  }
  return buckets;
}

// Clean and map repo nodes into dashboard-friendly structures
function processRepos(nodes, overrides) {
  return nodes.map(node => {
    const override = overrides[node.name] || {};

    // Normalize language stats
    const mainLang = node.primaryLanguage ? {
      name: node.primaryLanguage.name,
      color: node.primaryLanguage.color
    } : null;

    // Commit history: lastCommit + per-week heatmap buckets
    const histNodes = (node.defaultBranchRef &&
      node.defaultBranchRef.target &&
      node.defaultBranchRef.target.history &&
      node.defaultBranchRef.target.history.nodes) || [];
    let lastCommit = null;
    if (histNodes.length > 0) {
      const commitNode = histNodes[0];
      lastCommit = {
        message: commitNode.messageHeadline,
        date: commitNode.committedDate,
        author: commitNode.author ? commitNode.author.name : 'Unknown'
      };
    }
    const commitDates = histNodes.map(n => n.committedDate).filter(Boolean);
    const commitWeeks = aggregateWeeks(commitDates);

    // Merge manual overrides
    const description = override.description || node.description || '';
    const customTags = override.tags || [];

    // Extract raw topic strings
    const gitHubTopics = (node.repositoryTopics && node.repositoryTopics.nodes)
      ? node.repositoryTopics.nodes.map(n => n.topic.name)
      : [];

    const allTags = Array.from(new Set([...customTags, ...gitHubTopics]));

    return {
      name: node.name,
      url: node.url,
      description,
      isPrivate: node.isPrivate,
      isFork: node.isFork,
      isArchived: node.isArchived,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      pushedAt: node.pushedAt,
      stars: node.stargazerCount || 0,
      forks: node.forkCount || 0,
      issues: node.issues ? node.issues.totalCount : 0,
      pullRequests: node.pullRequests ? node.pullRequests.totalCount : 0,
      language: mainLang,
      tags: allTags,
      lastCommit,
      commitWeeks
    };
  });
}

// Perform GraphQL API requests
async function fetchGraphQL(token, cursor = null) {
  const query = `
    query($cursor: String) {
      viewer {
        repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER], orderBy: {field: PUSHED_AT, direction: DESC}) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            name description url homepageUrl
            isPrivate isFork isArchived isTemplate
            createdAt updatedAt pushedAt
            stargazerCount forkCount
            diskUsage
            primaryLanguage { name color }
            repositoryTopics(first: 10) { nodes { topic { name } } }
            issues(states: OPEN) { totalCount }
            pullRequests(states: OPEN) { totalCount }
            defaultBranchRef {
              name
              target { ... on Commit {
                history(first: 100) { nodes { messageHeadline committedDate author { name } } }
              } }
            }
          }
        }
      }
    }
  `;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `bearer ${token}`,
          'User-Agent': 'node.js'
        },
        body: JSON.stringify({ query, variables: { cursor } })
      });
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const data = await res.json();
      if (data.errors) throw new Error(JSON.stringify(data.errors));
      return data.data.viewer.repositories;
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`GraphQL attempt ${attempt} failed, retrying in ${Math.pow(2, attempt)}s...`);
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
}

async function run() {
  let rawData = [];
  const overrides = fs.existsSync(REPO_META_PATH)
    ? JSON.parse(fs.readFileSync(REPO_META_PATH, 'utf-8'))
    : {};

  if (process.env.MOCK_MODE === 'true') {
    console.log('Loading MOCK data from _probe-sample.json...');
    const fileContent = fs.readFileSync(SAMPLE_DATA_PATH, 'utf-8');
    rawData = JSON.parse(fileContent);
  } else {
    console.log('Fetching live repo data from GitHub...');
    const token = process.env.GH_PAT;
    if (!token) throw new Error('Missing GH_PAT environment variable');

    let hasNext = true;
    let cursor = null;
    while (hasNext) {
      const repos = await fetchGraphQL(token, cursor);
      rawData.push(...repos.nodes);
      hasNext = repos.pageInfo.hasNextPage;
      cursor = repos.pageInfo.endCursor;
      console.log(`Pulled ${rawData.length} repos so far...`);
    }
  }

  const processedData = processRepos(rawData, overrides);

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const chartJsContent = await getChartJsContent();
  let templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // Inject and write site
  templateContent = templateContent
    .replace('__CHART_JS_INLINE__', () => chartJsContent)
    .replace('__REPO_DATA__', () => JSON.stringify(processedData))
    .replace('__BUILD_TIME__', () => new Date().toISOString());

  fs.writeFileSync(DIST_PATH, templateContent, 'utf-8');
  console.log(`Build completed! ${processedData.length} repos written to dist/index.html`);
}

run().catch(err => {
  console.error('Fatal build failure:', err);
  process.exit(1);
});
