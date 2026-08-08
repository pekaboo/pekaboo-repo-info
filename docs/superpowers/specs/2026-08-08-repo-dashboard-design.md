# GitHub Repository Dashboard Design Specification

This document details the architectural specification and implementation design for the GitHub Repository Info dashboard.

## 1. Overview
The target of this project is to build an automated, self-contained GitHub Repository Dashboard. A nightly and manually triggered GitHub Action fetches metadata of all repositories belonging to the owner (including private, fork, and archived repositories), merges it with manual annotations, embeds the dataset in a single-file static HTML site, and publishes it via GitHub Pages. Access is private (since the source repository itself is private and served via private GitHub Pages).

## 2. Component Design & Architecture

```
                                      +--------------------------+
                                      |    GitHub GraphQL API    |
                                      +-------------+------------+
                                                    |
                                                    | (Paginated Query, 100/page)
                                                    v
+--------------------------+          +-------------+------------+          +--------------------------+
|  Manual Annotation Mapping| -------->|      scripts/build.js    | <-------- |   templates/index.html   |
|     (repo-meta.json)     |          +-------------+------------+          +--------------------------+
+--------------------------+                        |
                                                    | (Ingests data + templates,
                                                    |  minifies / inlines Chart.js)
                                                    v
                                      +-------------+------------+
                                      |      dist/index.html     |
                                      +-------------+------------+
                                                    |
                                                    | (workflow deploy via peaceiris/actions-gh-pages)
                                                    v
                                      +-------------+------------+
                                      |     gh-pages Branch      |
                                      +--------------------------+
```

---

## 3. Data Collection System

### 3.1 GraphQL Paginated Query
The query pulls up to 100 repositories per page (first: 100) using a cursor-paginated loop.

```graphql
query($cursor: String) {
  rateLimit { cost remaining nodeCount }
  viewer {
    repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name description url homepageUrl
        isPrivate isFork isArchived isTemplate
        createdAt updatedAt pushedAt
        stargazerCount forkCount
        diskUsage
        primaryLanguage { name color }
        languages(first: 1, orderBy: {field: SIZE, direction: DESC}) { totalSize edges { size node { name color } } }
        repositoryTopics(first: 10) { nodes { topic { name } } }
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        defaultBranchRef {
          name
          target { ... on Commit {
            history(first: 1) { totalCount nodes { messageHeadline committedDate author { name } } }
          } }
        }
      }
    }
  }
}
```

### 3.2 Metadata Compression & Merging
To optimize page size, `build.js` filters and compresses the GraphQL response:
- Reduces JSON size by stripping unused or nested properties (e.g. mapping `primaryLanguage` into a flat string).
- Merges with `repo-meta.json` to assign custom tags and descriptions (especially for the ~181 repos lacking description).
- Implements strict null guards for `defaultBranchRef` (non-initialized or empty repositories) and `primaryLanguage` (repositories with zero recognized code files).

### 3.3 Robustness & Retry Logic
- Network requests use a custom fetch wrapper with a maximum of 3 retries and exponential backoff (starting at 1000ms delay).
- Rate limits metrics are monitored; if the remaining GraphQL allowance drops below 50, a warning is logged.

---

## 4. GitHub Action Build Workflow (`.github/workflows/build.yml`)

### 4.1 Trigger Triggers
- **Cron schedule**: Daily at 02:00 UTC (`0 2 * * *`).
- **Workflow Dispatch**: Manual deployment trigger via the GitHub Action UI.

### 4.2 Security & PAT Rules
- Requires a Personal Access Token (PAT) stored as repository secret `GH_PAT` with `repo` scope to enable fetching of private repository information.
- The workflow itself runs on `ubuntu-latest` inside a secure environment.

### 4.3 Build and Fail-Safe Steps
1. Checkout of repository code base.
2. Installation of minimal Node.js dependencies (`graphql-request`).
3. Execution of `node scripts/build.js`.
4. Fallback execution recovery: If the build execution throws any unhandled error, the workflow logs a warning and exits with failure code. Importantly, it blocks the deployment step, preserving the previous stable `index.html` build.
5. Deploy build to `gh-pages` branch using `peaceiris/actions-gh-pages@v4`.

---

## 5. Web Interface (Templates & UI)

### 5.1 Technology Choice
- **Vanilla HTML + CSS + JS** packaged as a single self-contained document.
- **Chart.js** library downloaded at build time and injected inline into `<script>` tags to avoid external CDN runtime resolution issues.

### 5.2 Responsive Layout & Themes
- **Modern Glassmorphic Dark**: Obsidian/Violet background tint (`#0f0f1b`), card visual layout using translucent borders and blur filters (`backdrop-filter`) with interactive bounce transitions (`transform: translateY(-4px)` on hover).
- **Clean System Light CSS Theme**: Automatically matches system settings, toggled manually via a persistent navigation header button.
- **Statistics & Grid Overview**:
  - Three-column highlights header: Total Repos/Stars/Forks.
  - Active repo timelines plotting monthly push frequency.
  - Responsive layout adapts from desktop 3-grid layout down to list layout on mobile.
- **Interactivity Controls**:
  - Global Search (search name, desc, topics).
  - Multi-select language filter.
  - Public/Private/Fork/Archived status toggles.
  - Custom topic tags filter.
  - Grid vs List vs Grouped (grouped by principal language) toggles.
  - Data count-up transitions.

---

## 6. Implementation Stages & Verification Plan

Verification checks will test code behaviors directly:
- **Test Node Script locally**: Execution of `node scripts/build.js` should build a fully-formed `dist/index.html` referencing correct mock data.
- **Check GraphQL Null Guards**: Build parser logic tests with mocked `null` default branch references.
- **Render Tests**: Load page in desktop and mobile viewport resolutions, validating search filtering, language tags toggling, and dark/light color schemes.
