/**
 * ==========================================================================
 * Data & Analytics Curriculum Site — app logic
 * Content lives entirely in curriculum.json. This file never needs to
 * change when topics/content are added, edited, or reorganized there.
 * ==========================================================================
 */

const state = {
  root: null,
  nodeMap: new Map(),      // id -> node
  parentMap: new Map(),    // id -> parentId
  flatOrder: [],           // preorder ids, every node except root
  activeId: null,
  paginatedPages: [],
  currentPageIndex: 0,
  searchTerm: ''
};

const MAX_CHAR_CEILING = 380;

/* -------------------------------------------------------------------- */
/* Boot                                                                  */
/* -------------------------------------------------------------------- */

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  let data;
  try {
    const res = await fetch('curriculum.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    showBootError(err);
    return;
  }
  // Rendering errors are a separate failure mode from load errors — don't
  // mask a real bug behind a "couldn't load the file" message.
  initWithData(data);
}

function showBootError(err) {
  const viewport = document.getElementById('active-content-viewport');
  viewport.innerHTML = `
    <div class="boot-screen">
      <h2>Couldn't load curriculum.json</h2>
      <p>
        This usually happens when the page is opened directly as a file
        (<code>file://</code>), which browsers block from reading local JSON.
        Serve the folder over a local web server and reload, for example:
      </p>
      <p><code>python3 -m http.server 8000</code> &nbsp;then open&nbsp; <code>http://localhost:8000</code></p>
      <p>or open the folder with VS Code's "Live Server" extension.</p>
      <button class="boot-retry" onclick="boot()">Retry</button>
    </div>`;
  document.getElementById('header-progress').textContent = '';
  console.error(err);
}

function initWithData(data) {
  state.root = data;
  buildIndexes(data, null);
  renderSidebarTree();
  setupSearch();
  setupSidebarToggle();
  setupNavEventListeners();
  setupKeyboardListeners();
  updateProgressBadge();

  const firstLeaf = state.flatOrder.find(id => !hasChildren(state.nodeMap.get(id)));
  const startId = firstLeaf || state.flatOrder[0];
  if (startId) selectNode(startId, 0, false);
}

/* -------------------------------------------------------------------- */
/* Data indexing                                                        */
/* -------------------------------------------------------------------- */

function buildIndexes(node, parent) {
  state.nodeMap.set(node.id, node);
  if (parent) state.parentMap.set(node.id, parent.id);
  if (node.id !== state.root.id) state.flatOrder.push(node.id);
  (node.children || []).forEach(child => buildIndexes(child, node));
}

function hasChildren(node) {
  return !!(node && node.children && node.children.length);
}

function getAncestors(id) {
  const chain = [];
  let cur = state.parentMap.get(id);
  while (cur) {
    chain.unshift(cur);
    cur = state.parentMap.get(cur);
  }
  return chain; // does not include root, does not include id itself
}

function getPath(id) {
  return [...getAncestors(id), id];
}

function getDescendants(id) {
  const node = state.nodeMap.get(id);
  const ids = [];
  (node.children || []).forEach(child => {
    ids.push(child.id);
    ids.push(...getDescendants(child.id));
  });
  return ids;
}

function countLeaves(node) {
  if (!hasChildren(node)) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

function updateProgressBadge() {
  const totalLeaves = state.root.children.reduce((sum, c) => sum + countLeaves(c), 0);
  const withContent = state.flatOrder.filter(id => {
    const n = state.nodeMap.get(id);
    return !hasChildren(n) && n.blocks && n.blocks.length;
  }).length;
  document.getElementById('header-progress').textContent =
    `${withContent} / ${totalLeaves} topics drafted`;
}

/* -------------------------------------------------------------------- */
/* Sidebar tree rendering                                               */
/* -------------------------------------------------------------------- */

function renderSidebarTree() {
  const container = document.getElementById('sidebar-tree');
  container.innerHTML = '';
  state.root.children.forEach(child => {
    container.appendChild(buildTreeNode(child, 1));
  });
}

function buildTreeNode(node, depth) {
  if (hasChildren(node)) {
    const details = document.createElement('details');
    details.className = `tree-node depth-${depth}`;
    details.dataset.nodeId = node.id;
    if (depth === 1) details.open = true;

    const summary = document.createElement('summary');
    summary.innerHTML = `
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      <span class="node-label">${escapeHtml(node.text)}</span>`;
    summary.addEventListener('click', (e) => {
      // clicking the label itself (not the chevron area) also opens node overview
    });
    details.appendChild(summary);

    // Clicking the label text navigates to the hub/overview page for this node
    summary.querySelector('.node-label').addEventListener('click', (e) => {
      e.preventDefault();
      details.open = true;
      selectNode(node.id, 0, true);
    });

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'tree-children';
    node.children.forEach(child => childrenWrap.appendChild(buildTreeNode(child, depth + 1)));
    details.appendChild(childrenWrap);

    return details;
  } else {
    const btn = document.createElement('button');
    btn.className = 'leaf-btn';
    btn.dataset.nodeId = node.id;
    btn.textContent = node.text;
    if (node.blocks && node.blocks.length) btn.classList.add('has-content');
    btn.addEventListener('click', () => selectNode(node.id, 0, true));
    return btn;
  }
}

function markActiveInSidebar(id) {
  document.querySelectorAll('.leaf-btn.active').forEach(el => el.classList.remove('active'));
  const btn = document.querySelector(`.leaf-btn[data-node-id="${cssEscape(id)}"]`);
  if (btn) {
    btn.classList.add('active');
    if (typeof btn.scrollIntoView === 'function') btn.scrollIntoView({ block: 'nearest' });
  }
  // ensure ancestors are expanded
  getAncestors(id).forEach(ancestorId => {
    const details = document.querySelector(`details.tree-node[data-node-id="${cssEscape(ancestorId)}"]`);
    if (details) details.open = true;
  });
  const selfDetails = document.querySelector(`details.tree-node[data-node-id="${cssEscape(id)}"]`);
  if (selfDetails) selfDetails.open = true;
}

function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, m => `\\${m}`);
}

/* -------------------------------------------------------------------- */
/* Search                                                                */
/* -------------------------------------------------------------------- */

function setupSearch() {
  const input = document.getElementById('sidebar-search');
  input.addEventListener('input', () => {
    state.searchTerm = input.value.trim().toLowerCase();
    applySearchFilter();
  });
}

function applySearchFilter() {
  const term = state.searchTerm;
  const allDetails = document.querySelectorAll('details.tree-node');
  const allLeafBtns = document.querySelectorAll('.leaf-btn');

  if (!term) {
    allDetails.forEach(d => { d.style.display = ''; });
    allLeafBtns.forEach(b => {
      b.style.display = '';
      b.innerHTML = escapeHtml(b.textContent);
    });
    return;
  }

  // Determine matches among all nodes. A match reveals itself, its whole
  // subtree (so you can browse into a matching module/section), and its
  // ancestor chain (so the path to it stays visible).
  const matchedIds = new Set();
  state.flatOrder.forEach(id => {
    const node = state.nodeMap.get(id);
    if (node.text.toLowerCase().includes(term)) {
      matchedIds.add(id);
      getAncestors(id).forEach(a => matchedIds.add(a));
      getDescendants(id).forEach(d => matchedIds.add(d));
    }
  });

  allDetails.forEach(d => {
    const id = d.dataset.nodeId;
    d.style.display = matchedIds.has(id) ? '' : 'none';
    if (matchedIds.has(id)) d.open = true;
  });

  allLeafBtns.forEach(b => {
    const id = b.dataset.nodeId;
    const node = state.nodeMap.get(id);
    const match = matchedIds.has(id) && node.text.toLowerCase().includes(term);
    b.style.display = matchedIds.has(id) ? '' : 'none';
    b.innerHTML = match ? highlightMatch(node.text, term) : escapeHtml(node.text);
  });
}

function highlightMatch(text, term) {
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + term.length));
  const after = escapeHtml(text.slice(idx + term.length));
  return `${before}<span class="search-highlight">${match}</span>${after}`;
}

/* -------------------------------------------------------------------- */
/* Sidebar toggle (mobile + desktop collapse)                           */
/* -------------------------------------------------------------------- */

function setupSidebarToggle() {
  const sidebar = document.getElementById('dynamic-sidebar');
  const scrim = document.getElementById('sidebar-scrim');
  const toggle = document.getElementById('menu-toggle');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    scrim.classList.toggle('show', !sidebar.classList.contains('collapsed') && window.innerWidth <= 900);
  });

  scrim.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    scrim.classList.remove('show');
  });

  if (window.innerWidth <= 900) sidebar.classList.add('collapsed');
}

function closeSidebarOnMobileSelect() {
  if (window.innerWidth <= 900) {
    document.getElementById('dynamic-sidebar').classList.add('collapsed');
    document.getElementById('sidebar-scrim').classList.remove('show');
  }
}

/* -------------------------------------------------------------------- */
/* Content rendering                                                    */
/* -------------------------------------------------------------------- */

function selectNode(nodeId, targetPageIndex = 0, userInitiated = true) {
  const node = state.nodeMap.get(nodeId);
  if (!node) return;

  state.activeId = nodeId;
  markActiveInSidebar(nodeId);
  renderBreadcrumb(nodeId);

  if (hasChildren(node)) {
    renderHubPage(node);
    state.paginatedPages = [];
    state.currentPageIndex = 0;
    updatePaginationControls(true);
  } else {
    paginateLeaf(node);
    state.currentPageIndex = targetPageIndex === -1 ? state.paginatedPages.length - 1 : targetPageIndex;
    renderCurrentLeafPage(userInitiated);
  }

  if (userInitiated) closeSidebarOnMobileSelect();
}

function renderBreadcrumb(nodeId) {
  const bar = document.getElementById('breadcrumb-bar');
  bar.innerHTML = '';
  const path = getPath(nodeId);
  path.forEach((id, i) => {
    const node = state.nodeMap.get(id);
    const span = document.createElement('span');
    span.className = 'crumb' + (i === path.length - 1 ? ' current' : '');
    span.textContent = node.text;
    if (i !== path.length - 1) {
      span.addEventListener('click', () => selectNode(id, 0, true));
    }
    bar.appendChild(span);
    if (i !== path.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      bar.appendChild(sep);
    }
  });
}

function renderHubPage(node) {
  const targetFrame = document.getElementById('active-content-viewport');
  targetFrame.innerHTML = '';

  const view = document.createElement('div');
  view.className = 'content-page-view';

  const h2 = document.createElement('h2');
  h2.textContent = node.text;
  view.appendChild(h2);

  const pSum = document.createElement('p');
  pSum.className = 'summary-text';
  const leafCount = countLeaves(node);
  pSum.textContent = node.summary || `${node.children.length} sub-topic${node.children.length === 1 ? '' : 's'} · ${leafCount} lecture topic${leafCount === 1 ? '' : 's'} in total.`;
  view.appendChild(pSum);

  const grid = document.createElement('div');
  grid.className = 'hub-grid';
  node.children.forEach((child, i) => {
    const card = document.createElement('button');
    card.className = 'hub-card';
    const idxLabel = document.createElement('span');
    idxLabel.className = 'hub-card-index';
    idxLabel.textContent = hasChildren(child) ? `Group ${i + 1}` : `Topic ${i + 1}`;
    const titleLabel = document.createElement('span');
    titleLabel.className = 'hub-card-title';
    titleLabel.textContent = child.text;
    const metaLabel = document.createElement('span');
    metaLabel.className = 'hub-card-meta';
    metaLabel.textContent = hasChildren(child)
      ? `${countLeaves(child)} topics`
      : (child.blocks && child.blocks.length ? 'Content ready' : 'Content pending');
    card.appendChild(idxLabel);
    card.appendChild(titleLabel);
    card.appendChild(metaLabel);
    card.addEventListener('click', () => selectNode(child.id, 0, true));
    grid.appendChild(card);
  });
  view.appendChild(grid);

  targetFrame.appendChild(view);
  requestAnimationFrame(() => view.classList.remove('fade-out'));
}

function paginateLeaf(node) {
  state.paginatedPages = [];
  const blocks = node.blocks || [];

  if (!blocks.length) {
    state.paginatedPages.push({ isFirstPage: true, title: node.text, summary: node.summary, blocks: [], empty: true });
    return;
  }

  let currentPageBlocks = [];
  let weight = 0;
  let isFirst = true;

  blocks.forEach(block => {
    let blockWeight = 0;
    if (block.title) blockWeight += block.title.length;
    if (block.type === 'text') {
      blockWeight += (block.content || '').length;
    } else if (block.type === 'list') {
      (block.items || []).forEach(item => blockWeight += item.length);
    } else if (block.type === 'table') {
      blockWeight += 200;
      (block.headers || []).forEach(h => blockWeight += h.length);
      (block.rows || []).forEach(r => r.forEach(cell => blockWeight += String(cell).length));
    }

    if (weight + blockWeight > MAX_CHAR_CEILING && currentPageBlocks.length > 0) {
      state.paginatedPages.push({
        isFirstPage: isFirst,
        title: isFirst ? node.text : `${node.text} (cont.)`,
        summary: isFirst ? node.summary : null,
        blocks: currentPageBlocks
      });
      currentPageBlocks = [block];
      weight = blockWeight;
      isFirst = false;
    } else {
      currentPageBlocks.push(block);
      weight += blockWeight;
    }
  });

  if (currentPageBlocks.length > 0) {
    state.paginatedPages.push({
      isFirstPage: isFirst,
      title: isFirst ? node.text : `${node.text} (cont.)`,
      summary: isFirst ? node.summary : null,
      blocks: currentPageBlocks
    });
  }
}

function renderCurrentLeafPage(useTransition = true) {
  const targetFrame = document.getElementById('active-content-viewport');
  const pageData = state.paginatedPages[state.currentPageIndex];
  if (!pageData) return;

  const executeRender = () => {
    targetFrame.innerHTML = '';

    const view = document.createElement('div');
    view.className = 'content-page-view';
    if (useTransition) view.classList.add('fade-out');

    const h2 = document.createElement('h2');
    h2.textContent = pageData.title;
    view.appendChild(h2);

    if (pageData.summary) {
      const pSum = document.createElement('p');
      pSum.className = 'summary-text';
      pSum.textContent = pageData.summary;
      view.appendChild(pSum);
    }

    if (pageData.empty) {
      const placeholder = document.createElement('div');
      placeholder.className = 'content-placeholder';
      placeholder.innerHTML = `No content has been added for this topic yet.
        Add a <code>"summary"</code> and a <code>"blocks"</code> array to this
        node's entry (id: <code>${escapeHtml(state.activeId)}</code>) in
        <code>curriculum.json</code> — the site will pick it up automatically.`;
      view.appendChild(placeholder);
    } else {
      const blocksArea = document.createElement('div');
      blocksArea.className = 'blocks-container-area';

      pageData.blocks.forEach(block => {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'section-block';

        if (block.title) {
          const h3 = document.createElement('h3');
          h3.textContent = block.title;
          blockDiv.appendChild(h3);
        }

        if (block.type === 'text') {
          const p = document.createElement('p');
          p.textContent = block.content;
          blockDiv.appendChild(p);
        } else if (block.type === 'list') {
          const ul = document.createElement('ul');
          (block.items || []).forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = item;
            ul.appendChild(li);
          });
          blockDiv.appendChild(ul);
        } else if (block.type === 'table') {
          const wrapper = document.createElement('div');
          wrapper.className = 'table-responsive';
          const table = document.createElement('table');
          let hRow = '<thead><tr>';
          (block.headers || []).forEach(h => hRow += `<th>${escapeHtml(h)}</th>`);
          hRow += '</tr></thead>';
          let bRows = '<tbody>';
          (block.rows || []).forEach(r => {
            bRows += '<tr>';
            r.forEach(c => bRows += `<td>${c}</td>`);
            bRows += '</tr>';
          });
          bRows += '</tbody>';
          table.innerHTML = hRow + bRows;
          wrapper.appendChild(table);
          blockDiv.appendChild(wrapper);
        }

        blocksArea.appendChild(blockDiv);
      });

      view.appendChild(blocksArea);
    }

    targetFrame.appendChild(view);
    updatePaginationControls(false);

    if (useTransition) requestAnimationFrame(() => view.classList.remove('fade-out'));
  };

  if (useTransition && targetFrame.firstElementChild) {
    targetFrame.firstElementChild.classList.add('fade-out');
    setTimeout(executeRender, 220);
  } else {
    executeRender();
  }
}

/* -------------------------------------------------------------------- */
/* Pagination controls / global prev-next (walks whole tree, preorder)  */
/* -------------------------------------------------------------------- */

function updatePaginationControls(isHub) {
  const idx = state.flatOrder.indexOf(state.activeId);
  const atVeryStart = idx <= 0 && (isHub || state.currentPageIndex === 0);
  const atVeryEnd = idx === state.flatOrder.length - 1 &&
    (isHub || state.currentPageIndex === state.paginatedPages.length - 1);

  const total = isHub ? 1 : state.paginatedPages.length;
  const current = isHub ? 1 : state.currentPageIndex + 1;

  document.getElementById('page-indicator').textContent =
    `Topic ${idx + 1} of ${state.flatOrder.length} · Page ${current} of ${total}`;

  document.getElementById('btn-prev-page').disabled = atVeryStart;
  document.getElementById('btn-next-page').disabled = atVeryEnd;
}

function goToPrevPage() {
  const node = state.nodeMap.get(state.activeId);
  if (!hasChildren(node) && state.currentPageIndex > 0) {
    state.currentPageIndex--;
    renderCurrentLeafPage(true);
    return;
  }
  const idx = state.flatOrder.indexOf(state.activeId);
  if (idx > 0) selectNode(state.flatOrder[idx - 1], -1, false);
}

function goToNextPage() {
  const node = state.nodeMap.get(state.activeId);
  if (!hasChildren(node) && state.currentPageIndex < state.paginatedPages.length - 1) {
    state.currentPageIndex++;
    renderCurrentLeafPage(true);
    return;
  }
  const idx = state.flatOrder.indexOf(state.activeId);
  if (idx < state.flatOrder.length - 1) selectNode(state.flatOrder[idx + 1], 0, false);
}

function setupNavEventListeners() {
  document.getElementById('btn-prev-page').addEventListener('click', goToPrevPage);
  document.getElementById('btn-next-page').addEventListener('click', goToNextPage);
}

function setupKeyboardListeners() {
  window.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (event.key === 'ArrowLeft') goToPrevPage();
    else if (event.key === 'ArrowRight') goToNextPage();
  });
}

/* -------------------------------------------------------------------- */
/* Utils                                                                */
/* -------------------------------------------------------------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
