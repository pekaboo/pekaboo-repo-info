# GitHub Repository Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a GitHub Action that polls all user repositories (public & private), combines their metadata with a localized manual description file, and bundles them into an interactive dark/light dashboard page served via GitHub Pages.

**Architecture:** A lightweight Node.js script queries the GitHub GraphQL API in pages of 100, parses and cleans the response to minimize payload, downloads Chart.js scripts natively to inline them to ensure offline compatibility, merges user override tags/descriptions, and replaces a dynamic JSON placeholder within `templates/index.html` to output `dist/index.html`.

**Tech Stack:** Node.js (20+), GraphQL-Request (or built-in HTTPS client), Chart.js (inlined), CSS Variables, HTML5, Vanilla JavaScript.

## Global Constraints
- Target platform: Node 20+, Modern Viewport browsers.
- No heavy bundlers (like Webpack or Vite) or heavy JS frameworks (React/Vue) allowed for the UI build process. Must output a single static HTML containing inlined dependencies.
- Zero-dependency runtime preferred in generated pages; external network CDN packages must be avoided by inlining dependencies like Chart.js.

---

### Task 1: Scaffolding, Package Setup, and Mocking Mechanism

**Files:**
- Create: `package.json`
- Create: `repo-meta.json`
- Create: `.gitignore`
- Test: Local scripts execution verification.

**Interfaces:**
- Consumes: None.
- Produces: Initial files, dependencies setup, and a `repo-meta.json` with sample manual values.

- [ ] **Step 1: Write `package.json`**
Write the following contents to `/Users/mac/Code/GITHUB/pekaboo-repo-info/package.json`:
```json
{
  "name": "pekaboo-repo-info",
  "version": "1.0.0",
  "description": "Scans all user repos and builds a dashboard page",
  "main": "scripts/build.js",
  "type": "module",
  "scripts": {
    "build": "node scripts/build.js",
    "build:mock": "MOCK_MODE=true node scripts/build.js"
  },
  "dependencies": {},
  "devDependencies": {
    "undici": "^6.19.0"
  }
}
```

- [ ] **Step 2: Write initial `repo-meta.json`**
Write the following contents to `/Users/mac/Code/GITHUB/pekaboo-repo-info/repo-meta.json`:
```json
{
  "autostream": {
    "description": "An automated system to process live stream data feeds",
    "tags": ["Automation", "Streaming", "JavaScript"]
  },
  "WindowLayout": {
    "description": "Window position controller for macOS workspaces",
    "tags": ["macOS", "Desktop", "Utility"]
  }
}
```

- [ ] **Step 3: Write `.gitignore`**
Write the following contents to `/Users/mac/Code/GITHUB/pekaboo-repo-info/.gitignore`:
```
node_modules/
dist/
.DS_Store
```

- [ ] **Step 4: Install dependencies**
Run `npm install` inside the project root to ensure everything resolves correctly.
Run: `npm install`
Expected: Succeeds quickly.

- [ ] **Step 5: Commit**
Run:
```bash
git add package.json repo-meta.json .gitignore
git commit -m "chore: setup dependencies and initial files"
```

---

### Task 2: Build Script (`scripts/build.js`)

**Files:**
- Create: `scripts/build.js`

**Interfaces:**
- Consumes: `docs/_probe-sample.json` (as mock), `repo-meta.json` (as override data).
- Produces: JSON processing code and HTML templating engine.

- [ ] **Step 1: Write helper functions and mock parsing in `scripts/build.js`**
Write the core data parsing logic inside `/Users/mac/Code/GITHUB/pekaboo-repo-info/scripts/build.js`:
```javascript
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
  // Fallback to fetch if not cached
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
    const content = await res.text();
    fs.writeFileSync(cachePath, content, 'utf-8');
    return content;
  } catch (err) {
    console.error('Failed to fetch Chart.js', err);
    return '';
  }
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

    // Safety checks for commits
    let lastCommit = null;
    if (node.defaultBranchRef && 
        node.defaultBranchRef.target && 
        node.defaultBranchRef.target.history && 
        node.defaultBranchRef.target.history.nodes &&
        node.defaultBranchRef.target.history.nodes.length > 0) {
      const commitNode = node.defaultBranchRef.target.history.nodes[0];
      lastCommit = {
        message: commitNode.messageHeadline,
        date: commitNode.committedDate,
        author: commitNode.author ? commitNode.author.name : 'Unknown'
      };
    }

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
      lastCommit
    };
  });
}

// Perform GraphQL API requests (fallback if not in MOCK_MODE)
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
                history(first: 1) { nodes { messageHeadline committedDate author { name } } }
              } }
            }
          }
        }
      }
    }
  `;

  // Make standard request via fetch
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
    fs.mkdirSync(DIST_DIR);
  }

  const chartJsContent = await getChartJsContent();
  let templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  
  // Inject and write site
  templateContent = templateContent
    .replace('__CHART_JS_INLINE__', () => chartJsContent)
    .replace('__REPO_DATA__', () => JSON.stringify(processedData))
    .replace('__BUILD_TIME__', () => new Date().toISOString());

  fs.writeFileSync(DIST_PATH, templateContent, 'utf-8');
  console.log('Build completed! index.html saved to dist/');
}

run().catch(err => {
  console.error('Fatal build failure:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Create a dummy HTML template to check JavaScript execution**
Create verification template at `/Users/mac/Code/GITHUB/pekaboo-repo-info/templates/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Repos Dashboard Mock</title>
  <script>
    // Inlined Chart.js script space
    __CHART_JS_INLINE__
  </script>
</head>
<body>
  <h1>Test Page</h1>
  <script>
    const REPO_DATA = __REPO_DATA__;
    console.log("Loaded processed repo data count:", REPO_DATA.length);
    console.log("Check data sample:", REPO_DATA[0]);
  </script>
</body>
</html>
```

- [ ] **Step 3: Run the mock compilation trigger**
Run the mock build script locally to verify build logic and output format.
Run: `npm run build:mock`
Expected: Output files are processed successfully. Console prints "Build completed! index.html saved to dist/". Check that `dist/index.html` has inlined data and Chart.js code structure.

- [ ] **Step 4: Commit**
Run:
```bash
git add scripts/build.js templates/index.html
git commit -m "feat: implement data loading, parsing, and templating script"
```

---

### Task 3: Dashboard Web Interface (`templates/index.html`)

**Files:**
- Modify: `templates/index.html`

**Interfaces:**
- Consumes: Pre-populated custom client dataset injected as `__REPO_DATA__`.
- Produces: CSS layouts, responsiveness grids, search controllers, multi-select dropdown filters, tag selection hooks, Chart.js visualizations, and theme switcher.

- [ ] **Step 1: Write interactive responsive HTML structure, theme variables, and CSS structure**
Replace `/Users/mac/Code/GITHUB/pekaboo-repo-info/templates/index.html` with a complete responsive web structure featuring theme transitions, CSS utility variables, and data structures.
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My GitHub Repositories</title>
  <script>
    __CHART_JS_INLINE__
  </script>
  <style>
    :root {
      --bg: #0b0b14;
      --card-bg: rgba(255, 255, 255, 0.04);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-shadow: rgba(0, 0, 0, 0.3);
      --accent: #8b5cf6;
      --accent-glow: rgba(139, 92, 246, 0.35);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --badge-private: #f59e0b;
      --badge-fork: #3b82f6;
      --badge-archive: #ef4444;
      --header-bg: rgba(11, 11, 20, 0.7);
      --card-hover-bg: rgba(255, 255, 255, 0.08);
    }
    
    [data-theme="light"] {
      --bg: #f9fafb;
      --card-bg: #ffffff;
      --card-border: rgba(0, 0, 0, 0.08);
      --card-shadow: rgba(0, 0, 0, 0.05);
      --accent: #6d28d9;
      --accent-glow: rgba(109, 40, 217, 0.15);
      --text: #111827;
      --text-muted: #4b5563;
      --header-bg: rgba(249, 250, 251, 0.8);
      --card-hover-bg: #f3f4f6;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      transition: background-color 0.3s, color 0.3s;
      min-height: 100vh;
      padding-top: 80px;
    }
    
    header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 70px;
      backdrop-filter: blur(12px);
      background-color: var(--header-bg);
      border-bottom: 1px solid var(--card-border);
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 40px;
    }
    
    .nav-title { font-weight: 700; font-size: 1.25rem; display: flex; align-items: center; gap: 10px; }
    .theme-toggle {
      background: none;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .theme-toggle:hover {
      background-color: var(--card-hover-bg);
      border-color: var(--accent);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Stats Dashboard */
    .dashboard-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      box-shadow: 0 4px 6px var(--card-shadow);
    }
    .stat-card .val { font-size: 2.2rem; font-weight: 800; color: var(--accent); margin-bottom: 5px; }
    .stat-card .lbl { font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

    /* Visual Charts Section */
    .charts-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 25px;
      margin-bottom: 30px;
    }
    .chart-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 6px var(--card-shadow);
      min-height: 380px;
    }
    .chart-box h3 { margin-bottom: 20px; font-size: 1.1rem; color: var(--text-muted); }

    /* Search & Filter Controls */
    .controls-wrapper {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px var(--card-shadow);
    }
    .control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      align-items: center;
      margin-bottom: 15px;
    }
    .control-row:last-child { margin-bottom: 0; }
    .search-input {
      flex: 1;
      min-width: 250px;
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 10px 16px;
      border-radius: 8px;
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
    .select-dropdown, .control-btn {
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 10px 16px;
      border-radius: 8px;
      outline: none;
      cursor: pointer;
    }
    .control-btn.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    .tags-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .tag-bubble {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tag-bubble:hover, .tag-bubble.selected {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    /* Grid layout catalog */
    .repos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 25px;
    }
    
    .repos-grid.list-view {
      grid-template-columns: 1fr;
    }

    .repo-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 6px var(--card-shadow);
      transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
    }
    .repo-card:hover {
      transform: translateY(-4px);
      border-color: var(--accent);
      box-shadow: 0 10px 20px var(--accent-glow);
    }

    .repo-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
      gap: 10px;
    }
    .repo-title {
      font-size: 1.25rem;
      font-weight: 700;
      text-decoration: none;
      color: var(--text);
    }
    .repo-title:hover { color: var(--accent); }

    .badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge {
      font-size: 0.7rem;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 600;
      color: #fff;
      text-transform: uppercase;
    }
    .badge.private { background-color: var(--badge-private); }
    .badge.fork { background-color: var(--badge-fork); }
    .badge.archived { background-color: var(--badge-archive); }

    .repo-desc {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 16px;
      flex-grow: 1;
    }

    .indicators {
      display: flex;
      gap: 15px;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .indicator-item { display: flex; align-items: center; gap: 4px; }

    .repo-lang {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .lang-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .repo-commit {
      border-top: 1px solid var(--card-border);
      padding-top: 12px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .repo-commit-msg {
      font-style: italic;
      color: var(--text);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .repo-meta-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }
    .repo-tag {
      background: var(--card-hover-bg);
      color: var(--accent);
      font-size: 0.75rem;
      border-radius: 4px;
      padding: 2px 6px;
    }

    /* List view modifications */
    .list-view .repo-card {
      flex-direction: row;
      align-items: center;
      gap: 20px;
      padding: 16px 24px;
    }
    .list-view .repo-header { margin-bottom: 0; flex: 2; flex-direction: column; }
    .list-view .repo-desc { margin-bottom: 0; flex: 3; }
    .list-view .repo-lang { margin-bottom: 0; flex: 1; }
    .list-view .indicators { margin-bottom: 0; flex: 1; }
    .list-view .repo-commit { border-top: none; padding-top: 0; flex: 2; }
    .list-view .repo-meta-tags { flex: 1; margin-bottom: 0; }

    /* Grouped Header */
    .group-header {
      grid-column: 1 / -1;
      margin-top: 30px;
      margin-bottom: 15px;
      border-bottom: 2px solid var(--accent);
      padding-bottom: 8px;
      font-size: 1.5rem;
    }

    footer {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
      border-top: 1px solid var(--card-border);
      margin-top: 60px;
    }

    @media (max-width: 900px) {
      .charts-container { grid-template-columns: 1fr; }
      header { padding: 0 20px; }
      .list-view .repo-card { flex-direction: column; align-items: stretch; gap: 15px; }
    }
  </style>
</head>
<body data-theme="dark">

  <header>
    <div class="nav-title">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
      <span>Repo Insight Center</span>
    </div>
    <div style="display: flex; gap: 15px;">
      <button class="theme-toggle" id="themeBtn">Switch Light Mode</button>
    </div>
  </header>

  <div class="container">
    
    <!-- Stats Cards -->
    <div class="dashboard-stats" id="statsGrid">
      <div class="stat-card">
        <div class="val" id="statTotal">0</div>
        <div class="lbl">Total Repositories</div>
      </div>
      <div class="stat-card">
        <div class="val" id="statStars">0</div>
        <div class="lbl">Global Stars</div>
      </div>
      <div class="stat-card">
        <div class="val" id="statForks">0</div>
        <div class="lbl">Global Forks</div>
      </div>
      <div class="stat-card">
        <div class="val" id="statPrivate">0</div>
        <div class="lbl">Private Projects</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-container">
      <div class="chart-box">
        <h3>Primary Language Distribution</h3>
        <canvas id="langChart"></canvas>
      </div>
      <div class="chart-box">
        <h3>Push Activity Distributions (Monthly)</h3>
        <canvas id="activityChart"></canvas>
      </div>
    </div>

    <!-- Toolbar Filters -->
    <div class="controls-wrapper">
      <div class="control-row">
        <input type="text" class="search-input" id="searchInput" placeholder="Search by name, description, tags...">
        
        <select class="select-dropdown" id="langSelect">
          <option value="ALL">All Languages</option>
        </select>

        <select class="select-dropdown" id="sortSelect">
          <option value="pushed">Recently Pushed</option>
          <option value="stars">Stars Count</option>
          <option value="forks">Forks Count</option>
          <option value="created">Created Date</option>
        </select>
      </div>

      <div class="control-row">
        <button class="control-btn active" id="btnAllType">All</button>
        <button class="control-btn" id="btnSourceType">Source Only</button>
        <button class="control-btn" id="btnForkType">Forks Only</button>
        <button class="control-btn" id="btnPrivateType">Private Only</button>
        <button class="control-btn" id="btnPublicType">Public Only</button>

        <div style="flex-grow: 1;"></div>

        <button class="control-btn active" id="btnViewGrid">Grid Layout</button>
        <button class="control-btn" id="btnViewList">List Layout</button>
        <button class="control-btn" id="btnViewGrouped">Grouped Language</button>
      </div>

      <div class="tags-container" id="tagsContainer">
        <!-- populated by tags extraction -->
      </div>
    </div>

    <!-- Catalog view lists -->
    <div class="repos-grid" id="reposGrid">
      <!-- runtime updates -->
    </div>

  </div>

  <footer>
    <p>Auto-generated and deployed in nightly builds | Current Time: <span id="buildTimestamp">N/A</span></p>
  </footer>

  <script>
    // Embedded variables replaced on production run
    const REPO_DATA = __REPO_DATA__;
    const BUILD_TIME = '__BUILD_TIME__';
  </script>
</body>
</html>
```

- [ ] **Step 2: Add script controllers for Theme toggler and Data initial calculations**
Append the core rendering logic inside the main `<script>` tag in `/Users/mac/Code/GITHUB/pekaboo-repo-info/templates/index.html`:
```html
  <script>
    // Embedded variables replaced on production run
    const REPO_DATA = __REPO_DATA__;
    const BUILD_TIME = '__BUILD_TIME__';

    // Theme Management Hook
    const themeBtn = document.getElementById('themeBtn');
    themeBtn.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme');
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', nextTheme);
      themeBtn.textContent = nextTheme === 'dark' ? 'Switch Light Mode' : 'Switch Dark Mode';
      recreateCharts(); // update charts background/line colors
    });

    document.getElementById('buildTimestamp').textContent = new Date(BUILD_TIME).toLocaleString();

    // Stats calculations
    document.getElementById('statTotal').textContent = REPO_DATA.length;
    document.getElementById('statStars').textContent = REPO_DATA.reduce((acc, r) => acc + r.stars, 0);
    document.getElementById('statForks').textContent = REPO_DATA.reduce((acc, r) => acc + r.forks, 0);
    document.getElementById('statPrivate').textContent = REPO_DATA.filter(r => r.isPrivate).length;

    // Filters and sorting variables state
    let searchFilter = '';
    let selectedLang = 'ALL';
    let sortCriterion = 'pushed'; // pushed, stars, forks, created
    let relativeFilter = 'all'; // all, source, fork, private, public
    let currentViewMode = 'grid'; // grid, list, grouped
    let selectedTag = null;

    // Set dropdown options
    const langs = Array.from(new Set(REPO_DATA.map(r => r.language ? r.language.name : null).filter(Boolean))).sort();
    const langSelect = document.getElementById('langSelect');
    langs.forEach(lang => {
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = lang;
      langSelect.appendChild(opt);
    });

    // Populate standard visual tags from repositories metadata
    const tagCount = {};
    REPO_DATA.flatMap(r => r.tags).forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
    const popularTags = Object.keys(tagCount).sort((a,b) => tagCount[b] - tagCount[a]).slice(0, 15);
    const tagsContainer = document.getElementById('tagsContainer');
    popularTags.forEach(tag => {
      const tagBubble = document.createElement('span');
      tagBubble.className = 'tag-bubble';
      tagBubble.textContent = `${tag} (${tagCount[tag]})`;
      tagBubble.addEventListener('click', () => {
        if (selectedTag === tag) {
          selectedTag = null;
          tagBubble.classList.remove('selected');
        } else {
          document.querySelectorAll('.tag-bubble').forEach(b => b.classList.remove('selected'));
          selectedTag = tag;
          tagBubble.classList.add('selected');
        }
        applyFiltersAndRender();
      });
      tagsContainer.appendChild(tagBubble);
    });

    // Binding search bar changes
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchFilter = e.target.value.toLowerCase();
      applyFiltersAndRender();
    });

    langSelect.addEventListener('change', (e) => {
      selectedLang = e.target.value;
      applyFiltersAndRender();
    });

    document.getElementById('sortSelect').addEventListener('change', (e) => {
      sortCriterion = e.target.value;
      applyFiltersAndRender();
    });

    // Toggle button actions
    const buttonStates = [
      { id: 'btnAllType', val: 'all' },
      { id: 'btnSourceType', val: 'source' },
      { id: 'btnForkType', val: 'fork' },
      { id: 'btnPrivateType', val: 'private' },
      { id: 'btnPublicType', val: 'public' }
    ];
    buttonStates.forEach(btn => {
      document.getElementById(btn.id).addEventListener('click', () => {
        buttonStates.forEach(b => document.getElementById(b.id).classList.remove('active'));
        document.getElementById(btn.id).classList.add('active');
        relativeFilter = btn.val;
        applyFiltersAndRender();
      });
    });

    const viewModes = [
      { id: 'btnViewGrid', mode: 'grid' },
      { id: 'btnViewList', mode: 'list' },
      { id: 'btnViewGrouped', mode: 'grouped' }
    ];
    viewModes.forEach(vm => {
      document.getElementById(vm.id).addEventListener('click', () => {
        viewModes.forEach(m => document.getElementById(m.id).classList.remove('active'));
        document.getElementById(vm.id).classList.add('active');
        currentViewMode = vm.mode;
        applyFiltersAndRender();
      });
    });
  </script>
```

- [ ] **Step 3: Complete pagination rendering loop along with dynamic charts calculations**
Append the final rendering controllers and Chart.js instantiation codes inside the same tags in `/Users/mac/Code/GITHUB/pekaboo-repo-info/templates/index.html`:
```html
  <script>
    // Set relative date helpers
    function timeAgo(dateString) {
      if (!dateString) return 'never';
      const now = new Date();
      const past = new Date(dateString);
      const diffMs = now - past;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      return `${diffDays} days ago`;
    }

    // Sort function logic
    function sortRepos(repos) {
      return [...repos].sort((a, b) => {
        if (sortCriterion === 'pushed') {
          return new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0);
        } else if (sortCriterion === 'created') {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        } else if (sortCriterion === 'stars') {
          return b.stars - a.stars;
        } else if (sortCriterion === 'forks') {
          return b.forks - a.forks;
        }
        return 0;
      });
    }

    // Creating template elements dynamically
    function createRepoCard(repo) {
      const badgesHTML = `
        ${repo.isPrivate ? '<span class="badge private">Private</span>' : ''}
        ${repo.isFork ? '<span class="badge fork">Fork</span>' : ''}
        ${repo.isArchived ? '<span class="badge archived">Archived</span>' : ''}
      `;

      const tagsHTML = repo.tags.map(t => `<span class="repo-tag">${t}</span>`).join('');

      let commitHTML = '';
      if (repo.lastCommit) {
        commitHTML = `
          <div class="repo-commit">
            <div class="repo-commit-msg" title="${repo.lastCommit.message}">${repo.lastCommit.message}</div>
            <div style="font-size: 0.75rem;">By ${repo.lastCommit.author} · ${timeAgo(repo.lastCommit.date)}</div>
          </div>
        `;
      } else {
        commitHTML = `
          <div class="repo-commit" style="font-style: italic;">No commit details available</div>
        `;
      }

      const card = document.createElement('div');
      card.className = 'repo-card';
      card.innerHTML = `
        <div class="repo-header">
          <a href="${repo.url}" target="_blank" class="repo-title">${repo.name}</a>
          <div class="badges">${badgesHTML}</div>
        </div>
        <p class="repo-desc">${repo.description || '<i>No description provided</i>'}</p>
        <div class="repo-meta-tags">${tagsHTML}</div>
        <div class="repo-lang">
          ${repo.language ? `<span class="lang-dot" style="background-color: ${repo.language.color}"></span><span>${repo.language.name}</span>` : '<span>Unknown</span>'}
        </div>
        <div class="indicators">
          <div class="indicator-item">⭐ <span>${repo.stars}</span></div>
          <div class="indicator-item">🍴 <span>${repo.forks}</span></div>
          <div class="indicator-item">🐛 <span>${repo.issues}</span></div>
          <div class="indicator-item">🔀 <span>${repo.pullRequests}</span></div>
        </div>
        ${commitHTML}
      `;
      return card;
    }

    // Main Filters Engine
    function applyFiltersAndRender() {
      const container = document.getElementById('reposGrid');
      container.innerHTML = '';

      // Set Grid list modes
      if (currentViewMode === 'list') {
        container.classList.add('list-view');
      } else {
        container.classList.remove('list-view');
      }

      // Filter processing
      let filtered = REPO_DATA.filter(repo => {
        // String search match
        const matchesSearch = repo.name.toLowerCase().includes(searchFilter) || 
                              (repo.description && repo.description.toLowerCase().includes(searchFilter)) ||
                              repo.tags.some(t => t.toLowerCase().includes(searchFilter));

        // Primary Language Filtering
        const matchesLang = selectedLang === 'ALL' || (repo.language && repo.language.name === selectedLang);

        // Sub tags filtering
        const matchesTag = !selectedTag || repo.tags.includes(selectedTag);

        // Types Filtering
        let matchesType = true;
        if (relativeFilter === 'fork') matchesType = repo.isFork;
        else if (relativeFilter === 'source') matchesType = !repo.isFork;
        else if (relativeFilter === 'private') matchesType = repo.isPrivate;
        else if (relativeFilter === 'public') matchesType = !repo.isPrivate;

        return matchesSearch && matchesLang && matchesTag && matchesType;
      });

      const sorted = sortRepos(filtered);

      if (currentViewMode === 'grouped') {
        // Group by language
        const grouped = {};
        sorted.forEach(r => {
          const l = r.language ? r.language.name : 'Unknown';
          if (!grouped[l]) grouped[l] = [];
          grouped[l].push(r);
        });

        Object.keys(grouped).sort().forEach(lang => {
          const sectionHeader = document.createElement('div');
          sectionHeader.className = 'group-header';
          sectionHeader.textContent = `${lang} (${grouped[lang].length})`;
          container.appendChild(sectionHeader);

          grouped[lang].forEach(r => {
            container.appendChild(createRepoCard(r));
          });
        });
      } else {
        sorted.forEach(repo => {
          container.appendChild(createRepoCard(repo));
        });
      }
    }

    // Charts instantiators
    let langChartInstance = null;
    let activityChartInstance = null;

    function recreateCharts() {
      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const textSecondary = isDark ? '#9ca3af' : '#4b5563';
      const accent = '#8b5cf6';

      // 1. Language Count Mapping
      const langCounts = {};
      REPO_DATA.forEach(r => {
        const l = r.language ? r.language.name : 'Unknown';
        langCounts[l] = (langCounts[l] || 0) + 1;
      });
      const topLangs = Object.entries(langCounts).sort((a,b) => b[1] - a[1]).slice(0, 8);
      
      if (langChartInstance) langChartInstance.destroy();
      const ctxLang = document.getElementById('langChart').getContext('2d');
      langChartInstance = new Chart(ctxLang, {
        type: 'doughnut',
        data: {
          labels: topLangs.map(x => x[0]),
          datasets: [{
            data: topLangs.map(x => x[1]),
            backgroundColor: ['#6d28d9', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#374151', '#6b7280', '#9ca3af'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: textSecondary }
            }
          }
        }
      });

      // 2. Activity / Commits Timeline (Monthly)
      const monthlyPushes = {};
      REPO_DATA.forEach(r => {
        if (!r.pushedAt) return;
        const date = new Date(r.pushedAt);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyPushes[key] = (monthlyPushes[key] || 0) + 1;
      });

      const sortedMonths = Object.keys(monthlyPushes).sort().slice(-12);
      
      if (activityChartInstance) activityChartInstance.destroy();
      const ctxAct = document.getElementById('activityChart').getContext('2d');
      activityChartInstance = new Chart(ctxAct, {
        type: 'bar',
        data: {
          labels: sortedMonths,
          datasets: [{
            label: 'Repos Pushed',
            data: sortedMonths.map(m => monthlyPushes[m]),
            backgroundColor: accent,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: textSecondary } },
            y: { grid: { color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }, ticks: { color: textSecondary } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    // Initial trigger
    recreateCharts();
    applyFiltersAndRender();
  </script>
```

- [ ] **Step 4: Run target mock verification task**
Execute compilation loop to inspect layout configurations in build scripts.
Run: `npm run build:mock`
Expected: Output generated successfully. The index.html contains DOM configurations and JavaScript script structures under 600KB payload count.

- [ ] **Step 5: Commit**
Run:
```bash
git add templates/index.html
git commit -m "feat: complete UI styles, layouts, search triggers and charts rendering engines"
```

---

### Task 4: GitHub Action Setup (`.github/workflows/build.yml`)

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: GitHub Secrets Repository `GH_PAT`.
- Produces: Daily night-trigger and pipeline run updates.

- [ ] **Step 1: Write workflow settings file**
Create workflow at `/Users/mac/Code/GITHUB/pekaboo-repo-info/.github/workflows/build.yml`:
```yaml
name: Scan Repositories And Update Dashboard

on:
  schedule:
    - cron: '0 2 * * *'  # Run daily at 02:00 UTC
  workflow_dispatch:      # Enable manual run buttons

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-level: '20'
          cache: 'npm'

      - name: Install Project Dependencies
        run: npm ci || npm install

      - name: Generate Dashboard Build File
        run: npm run build
        env:
          GH_PAT: ${{ secrets.GH_PAT }}

      - name: Upload Page Artifact Output
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          force_orphan: true
```

- [ ] **Step 2: Commit**
Run:
```bash
git add .github/workflows/build.yml
git commit -m "feat: design actions workflow configurations"
```
