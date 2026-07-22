// 飲食店ネットワーク相関図 - 自由配置(位置は永続化)の相関図表示・編集ツール
// 入力データは manager.py --action export_for_html 相当の
// { metadata, nodes: [{id,label,node_type,area,group,genre,confidence,pos_x,pos_y}],
//   edges: [{id?,from_id,to_id,type,confidence,note}] } 形式を前提とする。
// ノードの位置(pos_x/pos_y)はデータの一部として永続化され、再読み込みしても変わらない。
// エリア・グループごとに背景ボックスを自動追従で描画する（エリア＞グループの入れ子）。

(() => {
  const RELATION_TYPES = ['same_building', 'family', 'business', 'other'];
  const RELATION_TYPE_LABELS = {
    same_building: '同じ建物',
    family: '家族',
    business: '取引',
    other: 'その他',
  };
  const SOURCE_OPTIONS = ['manual', 'web', 'lcdb'];
  const CONFIDENCE_OPTIONS = ['sure', 'medium', 'low'];

  const NODE_FIELD_SPECS = {
    owner: [
      { key: 'name', label: '名前', type: 'text', required: true },
      { key: 'area', label: 'エリア', type: 'text', required: true },
      { key: 'group', label: 'グループ', type: 'text' },
      { key: 'note', label: 'メモ', type: 'textarea' },
      { key: 'node_size', label: '相関図での円の大きさ', type: 'number', min: 0.5, max: 3, step: 0.1, default: 1 },
      { key: 'source', label: 'ソース', type: 'select', options: SOURCE_OPTIONS },
      { key: 'confidence', label: '信頼度', type: 'select', options: CONFIDENCE_OPTIONS },
    ],
    shop: [
      { key: 'name', label: '名前', type: 'text', required: true },
      { key: 'genre', label: 'ジャンル', type: 'text' },
      { key: 'area', label: 'エリア', type: 'text', required: true },
      { key: 'group', label: 'グループ', type: 'text' },
      { key: 'address', label: '住所', type: 'text' },
      { key: 'tabelog_url', label: '食べログURL', type: 'text' },
      { key: 'salesforce_url', label: 'SalesforceURL', type: 'text' },
      { key: 'source', label: 'ソース', type: 'select', options: SOURCE_OPTIONS },
      { key: 'confidence', label: '信頼度', type: 'select', options: CONFIDENCE_OPTIONS },
    ],
  };

  const svg = document.getElementById('viz-graph');
  const viewport = document.getElementById('viz-viewport');
  const dropZone = document.getElementById('viz-dropZone');
  const tooltip = document.getElementById('viz-tooltip');
  const zoomPercentEl = document.getElementById('viz-zoomPercent');
  const areaFilterSelect = document.getElementById('viz-areaFilter');
  const groupFilterSelect = document.getElementById('viz-groupFilter');
  const visibilityModeSelect = document.getElementById('viz-visibilityMode');
  const statOwners = document.getElementById('viz-statOwners');
  const statShops = document.getElementById('viz-statShops');
  const statRelations = document.getElementById('viz-statRelations');
  const guideModal = document.getElementById('viz-guideModal');
  const searchBox = document.getElementById('viz-searchBox');
  const searchResults = document.getElementById('viz-searchResults');
  const selectionPanel = document.getElementById('viz-selectionPanel');
  const selectionTitle = document.getElementById('viz-selectionTitle');
  const selectionDetail = document.getElementById('viz-selectionDetail');
  const selectionNeighbors = document.getElementById('viz-selectionNeighbors');
  const neighborsSection = document.getElementById('viz-neighborsSection');
  const canvasWrap = document.getElementById('viz-canvasWrap');
  const connectModeBtn = document.getElementById('viz-connectMode');
  const relationModal = document.getElementById('viz-relationModal');

  let regionsGroup = null;
  let edgesGroup = null;
  let nodesGroup = null;

  const camera = { scale: 1.0, x: 0, y: 0 };
  const state = { nodes: [], edges: [], nodeById: new Map() };
  const nodeElements = new Map();
  const edgeElements = new Map();
  let selectedNodeId = null;
  let selectedRelationId = null;
  let editingNodeId = null;
  let editingRelationId = null;

  // パン(背景ドラッグ)の状態
  let isPanning = false;
  let panMoved = false;
  let panStart = { x: 0, y: 0 };
  let cameraStart = { x: 0, y: 0 };
  let dragSimplified = false;

  // ノードドラッグの状態
  let draggingNode = null;
  let nodeDragStart = { x: 0, y: 0 };
  let nodeStartPos = { x: 0, y: 0 };
  let nodeDragMoved = false;

  // 関係をつなぐモード
  let connectMode = false;
  let connectFromId = null;
  let connectDragActive = false;
  let connectDragMoved = false;
  let connectDragWasFresh = false;
  let connectDragStart = { x: 0, y: 0 };
  let connectDragLine = null;

  function hasEditorBridge() {
    return !!window.NetworkEditor;
  }

  function nodeRadius(n) {
    const nodeSize = n.node_type === 'owner' && Number.isFinite(n.node_size) ? n.node_size : 1;
    return (n.node_type === 'owner' ? 10 : 7) * nodeSize;
  }

  // ------------------------------------------------------------------
  // データ読み込み・自由配置（新規ノードはグループ単位でクラスタ配置）
  // ------------------------------------------------------------------
  function hashHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return hash % 360;
  }

  function localSpiralOffset(index) {
    if (index === 0) return { x: 0, y: 0 };
    const LOCAL_SPACING = 85;
    let ring = 1;
    let count = 6;
    let idx = index - 1;
    while (idx >= count) {
      idx -= count;
      ring++;
      count = 6 * ring;
    }
    const angle = (idx / count) * Math.PI * 2;
    return { x: Math.cos(angle) * LOCAL_SPACING * ring, y: Math.sin(angle) * LOCAL_SPACING * ring };
  }

  function assignPositions(nodes) {
    const CLUSTER_SPACING_X = 420;
    const CLUSTER_SPACING_Y = 320;
    const groupKeyOf = n => (n.group || '') + '|' + (n.area || '');

    const existingPositions = nodes.filter(n => Number.isFinite(n.pos_x) && Number.isFinite(n.pos_y));
    const usedClusterCells = new Set();
    existingPositions.forEach(n => {
      const cx = Math.round(n.pos_x / CLUSTER_SPACING_X);
      const cy = Math.round(n.pos_y / CLUSTER_SPACING_Y);
      usedClusterCells.add(cx + ',' + cy);
    });

    function nextClusterCell() {
      for (let radius = 0; radius < 500; radius++) {
        for (let gy = -radius; gy <= radius; gy++) {
          for (let gx = -radius; gx <= radius; gx++) {
            if (Math.max(Math.abs(gx), Math.abs(gy)) !== radius) continue;
            const key = gx + ',' + gy;
            if (!usedClusterCells.has(key)) { usedClusterCells.add(key); return { gx, gy }; }
          }
        }
      }
      return { gx: 0, gy: 0 };
    }

    const groupCenters = new Map();
    const groupLocalCount = new Map();

    nodes.forEach(n => {
      if (Number.isFinite(n.pos_x) && Number.isFinite(n.pos_y)) {
        n.x = n.pos_x;
        n.y = n.pos_y;
        return;
      }
      const key = groupKeyOf(n);
      if (!groupCenters.has(key)) {
        const existingSame = existingPositions.filter(m => groupKeyOf(m) === key);
        if (existingSame.length) {
          const cx = existingSame.reduce((s, m) => s + m.pos_x, 0) / existingSame.length;
          const cy = existingSame.reduce((s, m) => s + m.pos_y, 0) / existingSame.length;
          groupCenters.set(key, { x: cx, y: cy });
        } else {
          const { gx, gy } = nextClusterCell();
          groupCenters.set(key, { x: gx * CLUSTER_SPACING_X, y: gy * CLUSTER_SPACING_Y });
        }
        groupLocalCount.set(key, 0);
      }
      const center = groupCenters.get(key);
      const idx = groupLocalCount.get(key);
      groupLocalCount.set(key, idx + 1);
      const offset = localSpiralOffset(idx);
      n.pos_x = center.x + offset.x;
      n.pos_y = center.y + offset.y;
      n.x = n.pos_x;
      n.y = n.pos_y;
      if (hasEditorBridge()) window.NetworkEditor.setNodePosition(n.id, n.pos_x, n.pos_y);
    });
  }

  function loadFromObject(parsed) {
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      alert('export_for_html 形式のJSONを指定してください（nodes / edges が必要です）');
      return;
    }
    state.nodes = parsed.nodes.map(n => ({ ...n }));
    state.edges = parsed.edges.filter(
      e => parsed.nodes.some(n => n.id === e.from_id) && parsed.nodes.some(n => n.id === e.to_id)
    );
    state.nodeById = new Map(state.nodes.map(n => [n.id, n]));

    dropZone.classList.toggle('hidden', state.nodes.length > 0);
    assignPositions(state.nodes);
    populateFilters();
    render();
    if (!selectedNodeId && !selectedRelationId) fitView(false);
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        loadFromObject(JSON.parse(e.target.result));
      } catch (err) {
        alert('JSONの解析に失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  document.getElementById('viz-fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadFile(file);
  });

  canvasWrap.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  canvasWrap.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  canvasWrap.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // ------------------------------------------------------------------
  // 描画
  // ------------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function edgeKey(e) {
    return `${e.from_id}__${e.to_id}`;
  }

  function render() {
    viewport.innerHTML = '';
    nodeElements.clear();
    edgeElements.clear();

    regionsGroup = document.createElementNS(SVG_NS, 'g');
    regionsGroup.setAttribute('id', 'regions');
    edgesGroup = document.createElementNS(SVG_NS, 'g');
    edgesGroup.setAttribute('id', 'edges');
    nodesGroup = document.createElementNS(SVG_NS, 'g');
    nodesGroup.setAttribute('id', 'nodes');
    viewport.appendChild(regionsGroup);
    viewport.appendChild(edgesGroup);
    viewport.appendChild(nodesGroup);

    state.edges.forEach(e => {
      const from = state.nodeById.get(e.from_id);
      const to = state.nodeById.get(e.to_id);
      if (!from || !to) return;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', `edge ${e.type}${e.id ? ' selectable' : ''}`);
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      line.addEventListener('mouseenter', ev => showTooltip(ev, `関係: ${e.type}\n信頼度: ${e.confidence || '-'}${e.id ? '\n（クリックで編集）' : ''}`));
      line.addEventListener('mousemove', moveTooltip);
      line.addEventListener('mouseleave', hideTooltip);
      line.addEventListener('click', ev => {
        ev.stopPropagation();
        if (connectMode || !e.id) return;
        selectRelation(e);
      });
      edgesGroup.appendChild(line);
      edgeElements.set(edgeKey(e), line);
    });

    state.nodes.forEach(n => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `node ${n.node_type}`);
      g.setAttribute('id', `node_${n.id}`);
      g.setAttribute('transform', `translate(${n.x}, ${n.y})`);

      const radius = nodeRadius(n);

      const hitArea = document.createElementNS(SVG_NS, 'circle');
      hitArea.setAttribute('r', Math.max(16, radius + 6));
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('class', 'hit-area');
      g.appendChild(hitArea);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', radius);
      g.appendChild(circle);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', radius + 3);
      text.setAttribute('y', 4);
      text.textContent = n.label;
      g.appendChild(text);
      nodesGroup.appendChild(g); // getBBox()は接続済みDOMでないと正しい値を返さないため先に接続する

      // ラベルの文字間の隙間から背後の線に反応しないよう、透明な当たり判定を上に重ねる
      const labelBox = text.getBBox();
      const labelHit = document.createElementNS(SVG_NS, 'rect');
      labelHit.setAttribute('x', labelBox.x - 2);
      labelHit.setAttribute('y', labelBox.y - 2);
      labelHit.setAttribute('width', labelBox.width + 4);
      labelHit.setAttribute('height', labelBox.height + 4);
      labelHit.setAttribute('fill', 'transparent');
      labelHit.setAttribute('class', 'hit-area');
      g.appendChild(labelHit);

      g.addEventListener('mouseenter', ev => {
        const lines = [n.label, `種別: ${n.node_type === 'owner' ? 'オーナー' : '店舗'}`, `エリア: ${n.area || '-'}`];
        if (n.group) lines.push(`グループ: ${n.group}`);
        if (n.genre) lines.push(`ジャンル: ${n.genre}`);
        if (n.confidence) lines.push(`信頼度: ${n.confidence}`);
        if (isSafeUrl(n.tabelog_url) || isSafeUrl(n.salesforce_url)) lines.push('（クリックでリンクを表示）');
        showTooltip(ev, lines.join('\n'));
      });
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', hideTooltip);

      g.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        if (connectMode) { ev.stopPropagation(); return; }
        ev.stopPropagation();
        draggingNode = n;
        nodeDragMoved = false;
        nodeDragStart = { x: ev.clientX, y: ev.clientY };
        nodeStartPos = { x: n.x, y: n.y };
        g.classList.add('dragging');
      });

      g.addEventListener('pointerdown', ev => {
        if (!connectMode) return;
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        startConnectDrag(n, ev);
      });

      g.addEventListener('click', ev => {
        ev.stopPropagation();
        if (connectMode) return; // 関係をつなぐモードの操作はpointerdown/upで完結する
        if (nodeDragMoved) { nodeDragMoved = false; return; }
        selectNode(n);
      });

      g.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        if (connectMode) return;
        centerOnNode(n);
      });

      if (n.id === connectFromId) g.classList.add('connect-from');
      nodeElements.set(n.id, g);
    });

    applyFilters();
    renderRegionBoxes();
    updateStats();
    if (selectedNodeId) {
      const n = state.nodeById.get(selectedNodeId);
      if (n) renderSelectionHighlight('node', selectedNodeId); else clearSelection();
    } else if (selectedRelationId) {
      const e = state.edges.find(edge => edge.id === selectedRelationId);
      if (e) renderSelectionHighlight('relation', e); else clearSelection();
    }
  }

  function updateEdgePositionsForNode(nodeId) {
    state.edges.forEach(e => {
      if (e.from_id !== nodeId && e.to_id !== nodeId) return;
      const el = edgeElements.get(edgeKey(e));
      const from = state.nodeById.get(e.from_id);
      const to = state.nodeById.get(e.to_id);
      if (!el || !from || !to) return;
      el.setAttribute('x1', from.x);
      el.setAttribute('y1', from.y);
      el.setAttribute('x2', to.x);
      el.setAttribute('y2', to.y);
    });
  }

  // ------------------------------------------------------------------
  // グループ背景ボックス（自動追従・エリア＞グループの入れ子）
  // ------------------------------------------------------------------
  function drawRegionRect({ x1, y1, x2, y2, fill, stroke, label, labelColor }) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x1);
    rect.setAttribute('y', y1);
    rect.setAttribute('width', Math.max(x2 - x1, 1));
    rect.setAttribute('height', Math.max(y2 - y1, 1));
    rect.setAttribute('rx', 16);
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', 1.5);
    rect.setAttribute('class', 'region-box');
    regionsGroup.appendChild(rect);

    if (label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', x1 + 12);
      text.setAttribute('y', y1 + 20);
      text.setAttribute('class', 'region-label');
      text.setAttribute('fill', labelColor);
      text.textContent = label;
      regionsGroup.appendChild(text);
    }
  }

  function renderRegionBoxes() {
    if (!regionsGroup) return;
    regionsGroup.innerHTML = '';
    const overview = areaFilterSelect.value === '全体';
    const visibleNodes = state.nodes.filter(isNodeVisible);

    const byArea = new Map();
    visibleNodes.forEach(n => {
      const area = n.area || '';
      if (!area) return;
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(n);
    });

    const showAreaBoxes = overview && byArea.size > 1;
    const AREA_PAD = 55;
    const GROUP_PAD = 30;

    byArea.forEach((nodesInArea, area) => {
      const areaHue = hashHue(area);

      if (showAreaBoxes) {
        const xs = nodesInArea.map(n => n.x);
        const ys = nodesInArea.map(n => n.y);
        drawRegionRect({
          x1: Math.min(...xs) - AREA_PAD, y1: Math.min(...ys) - AREA_PAD,
          x2: Math.max(...xs) + AREA_PAD, y2: Math.max(...ys) + AREA_PAD - 10,
          fill: `hsla(${areaHue}, 55%, 55%, 0.10)`,
          stroke: `hsla(${areaHue}, 55%, 40%, 0.35)`,
          label: area,
          labelColor: `hsl(${areaHue}, 55%, 32%)`,
        });
      }

      const byGroup = new Map();
      nodesInArea.forEach(n => {
        const group = n.group || '';
        if (!group) return;
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(n);
      });

      byGroup.forEach((nodesInGroup, group) => {
        if (nodesInGroup.length < 2) return;
        const groupHue = overview ? areaHue + ((hashHue(group) % 50) - 25) : hashHue(group);
        const gxs = nodesInGroup.map(n => n.x);
        const gys = nodesInGroup.map(n => n.y);
        drawRegionRect({
          x1: Math.min(...gxs) - GROUP_PAD, y1: Math.min(...gys) - GROUP_PAD,
          x2: Math.max(...gxs) + GROUP_PAD, y2: Math.max(...gys) + GROUP_PAD - 12,
          fill: `hsla(${groupHue}, 60%, 50%, 0.20)`,
          stroke: `hsla(${groupHue}, 60%, 35%, 0.55)`,
          label: group,
          labelColor: `hsl(${groupHue}, 60%, 28%)`,
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // ツールチップ
  // ------------------------------------------------------------------
  function showTooltip(ev, text) {
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    moveTooltip(ev);
  }
  function moveTooltip(ev) {
    const wrapRect = canvasWrap.getBoundingClientRect();
    let left = ev.clientX - wrapRect.left + 12;
    let top = ev.clientY - wrapRect.top + 12;
    left = Math.min(left, wrapRect.width - 220);
    top = Math.min(top, wrapRect.height - 100);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // 選択・つながりハイライト（ノード／関係共通）
  // ------------------------------------------------------------------
  function getNeighborEdges(nodeId) {
    return state.edges.filter(e => e.from_id === nodeId || e.to_id === nodeId);
  }

  function isSafeUrl(url) {
    return /^https?:\/\//i.test(url || '');
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function selectNode(n) {
    selectedNodeId = n.id;
    selectedRelationId = null;
    editingNodeId = null;
    editingRelationId = null;
    renderSelectionHighlight('node', n.id);
    renderNodePanel(n);
  }

  function selectRelation(e) {
    selectedNodeId = null;
    selectedRelationId = e.id;
    editingNodeId = null;
    editingRelationId = null;
    renderSelectionHighlight('relation', e);
    renderRelationPanel(e);
  }

  function clearSelection() {
    selectedNodeId = null;
    selectedRelationId = null;
    editingNodeId = null;
    editingRelationId = null;
    nodeElements.forEach(g => g.classList.remove('selected'));
    edgeElements.forEach(el => el.classList.remove('emphasized'));
    selectionPanel.classList.add('hidden');
    applyFilters();
  }

  function renderSelectionHighlight(kind, target) {
    let egoIds;
    let emphasizedEdgeId = null;
    if (kind === 'node') {
      egoIds = new Set([target]);
      getNeighborEdges(target).forEach(e => { egoIds.add(e.from_id); egoIds.add(e.to_id); });
    } else {
      egoIds = new Set([target.from_id, target.to_id]);
      emphasizedEdgeId = target.id;
    }

    state.nodes.forEach(n => {
      const g = nodeElements.get(n.id);
      if (!g) return;
      g.classList.toggle('selected', kind === 'node' && n.id === target);
      const inEgo = egoIds.has(n.id);
      g.style.opacity = inEgo ? '1' : '0.15';
      g.style.display = '';
    });

    state.edges.forEach(e => {
      const el = edgeElements.get(edgeKey(e));
      if (!el) return;
      const touches = kind === 'node'
        ? (e.from_id === target || e.to_id === target)
        : e.id === emphasizedEdgeId;
      el.classList.toggle('emphasized', touches);
      el.style.opacity = touches ? '1' : '0.06';
      el.style.display = '';
    });
  }

  function renderNodePanel(n) {
    selectionPanel.classList.remove('hidden');
    selectionTitle.textContent = '選択中のノード';
    neighborsSection.classList.remove('hidden');
    if (editingNodeId === n.id) {
      renderNodeEditForm(n);
      return;
    }

    const lines = [`<div class="selection-name">${escapeHtml(n.label)}</div>`];
    lines.push(`<div class="selection-meta">${n.node_type === 'owner' ? 'オーナー' : '店舗'} ・ ${escapeHtml(n.area || '-')}</div>`);
    if (n.group) lines.push(`<div class="selection-meta">グループ: ${escapeHtml(n.group)}</div>`);
    if (n.genre) lines.push(`<div class="selection-meta">ジャンル: ${escapeHtml(n.genre)}</div>`);
    if (n.confidence) lines.push(`<div class="selection-meta">信頼度: ${escapeHtml(n.confidence)}</div>`);
    const links = [];
    if (isSafeUrl(n.tabelog_url)) links.push(`<a class="selection-link" href="${escapeHtml(n.tabelog_url)}" target="_blank" rel="noopener noreferrer">食べログ ↗</a>`);
    if (isSafeUrl(n.salesforce_url)) links.push(`<a class="selection-link" href="${escapeHtml(n.salesforce_url)}" target="_blank" rel="noopener noreferrer">Salesforce ↗</a>`);
    if (links.length) lines.push(`<div class="selection-links">${links.join('')}</div>`);
    selectionDetail.innerHTML = lines.join('');

    if (hasEditorBridge()) {
      const actions = document.createElement('div');
      actions.className = 'selection-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'ghost-btn';
      editBtn.textContent = '✏️ 編集';
      editBtn.addEventListener('click', () => { editingNodeId = n.id; renderNodePanel(n); });
      const delBtn = document.createElement('button');
      delBtn.className = 'ghost-btn danger';
      delBtn.textContent = '🗑️ 削除';
      delBtn.addEventListener('click', () => {
        const ok = n.node_type === 'owner'
          ? window.NetworkEditor.deleteOwner(n.id)
          : window.NetworkEditor.deleteShop(n.id);
        if (ok) {
          window.NetworkEditor.saveToStorage();
          window.NetworkEditor.renderAll();
          clearSelection();
          loadFromObject(window.NetworkEditor.buildVisualizerPayload());
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      selectionDetail.appendChild(actions);
    }

    renderNeighborList(n);
  }

  function renderNeighborList(n) {
    selectionNeighbors.innerHTML = '';
    const neighborEdges = getNeighborEdges(n.id);
    if (!neighborEdges.length) {
      const li = document.createElement('li');
      li.textContent = 'つながりはありません';
      li.style.cursor = 'default';
      selectionNeighbors.appendChild(li);
    }
    neighborEdges.forEach(e => {
      const otherId = e.from_id === n.id ? e.to_id : e.from_id;
      const other = state.nodeById.get(otherId);
      if (!other) return;
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = other.label;
      const typeSpan = document.createElement('span');
      typeSpan.className = 'neighbor-type';
      typeSpan.textContent = e.type;
      li.appendChild(nameSpan);
      li.appendChild(typeSpan);
      li.addEventListener('click', () => {
        selectNode(other);
        centerOnNode(other);
      });
      selectionNeighbors.appendChild(li);
    });
  }

  function buildFieldInput(spec, value) {
    let input;
    if (spec.type === 'select') {
      input = document.createElement('select');
      spec.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = (spec.labels && spec.labels[opt]) || opt;
        input.appendChild(o);
      });
    } else if (spec.type === 'textarea') {
      input = document.createElement('textarea');
    } else if (spec.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      if (spec.min !== undefined) input.min = spec.min;
      if (spec.max !== undefined) input.max = spec.max;
      if (spec.step !== undefined) input.step = spec.step;
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.value = (value !== undefined && value !== null && value !== '') ? value : '';
    return input;
  }

  function renderNodeEditForm(n) {
    selectionDetail.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'inline-edit-form';
    const specs = NODE_FIELD_SPECS[n.node_type];
    const inputs = {};

    specs.forEach(spec => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = spec.label;
      wrap.appendChild(label);
      const sourceValue = spec.key === 'name' ? n.label : n[spec.key];
      const rawValue = sourceValue !== undefined && sourceValue !== null && sourceValue !== '' ? sourceValue : spec.default;
      const input = buildFieldInput(spec, rawValue);
      wrap.appendChild(input);
      form.appendChild(wrap);
      inputs[spec.key] = input;
    });

    const errorEl = document.createElement('p');
    errorEl.className = 'inline-edit-error hidden';
    form.appendChild(errorEl);

    const actions = document.createElement('div');
    actions.className = 'selection-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghost-btn';
    cancelBtn.textContent = 'キャンセル';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);
    selectionDetail.appendChild(form);

    cancelBtn.addEventListener('click', () => { editingNodeId = null; renderNodePanel(n); });
    saveBtn.addEventListener('click', () => {
      const values = {};
      specs.forEach(spec => { values[spec.key] = inputs[spec.key].value; });
      try {
        window.NetworkEditor.updateEntity(n.node_type, n.id, values);
        window.NetworkEditor.saveToStorage();
        window.NetworkEditor.renderAll();
        editingNodeId = null;
        loadFromObject(window.NetworkEditor.buildVisualizerPayload());
        const refreshed = state.nodeById.get(n.id);
        if (refreshed) selectNode(refreshed);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  function renderRelationPanel(e) {
    selectionPanel.classList.remove('hidden');
    selectionTitle.textContent = '選択中の関係';
    neighborsSection.classList.add('hidden');
    if (editingRelationId === e.id) {
      renderRelationEditForm(e);
      return;
    }

    const from = state.nodeById.get(e.from_id);
    const to = state.nodeById.get(e.to_id);
    const lines = [`<div class="selection-name">${escapeHtml(from ? from.label : '?')} ↔ ${escapeHtml(to ? to.label : '?')}</div>`];
    lines.push(`<div class="selection-meta">関係タイプ: ${escapeHtml(e.type)}</div>`);
    if (e.note) lines.push(`<div class="selection-meta">メモ: ${escapeHtml(e.note)}</div>`);
    if (e.confidence) lines.push(`<div class="selection-meta">信頼度: ${escapeHtml(e.confidence)}</div>`);
    selectionDetail.innerHTML = lines.join('');

    if (hasEditorBridge()) {
      const actions = document.createElement('div');
      actions.className = 'selection-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'ghost-btn';
      editBtn.textContent = '✏️ 編集';
      editBtn.addEventListener('click', () => { editingRelationId = e.id; renderRelationPanel(e); });
      const delBtn = document.createElement('button');
      delBtn.className = 'ghost-btn danger';
      delBtn.textContent = '🗑️ 削除';
      delBtn.addEventListener('click', () => {
        const ok = window.NetworkEditor.deleteRelation(e.id);
        if (ok) {
          window.NetworkEditor.saveToStorage();
          window.NetworkEditor.renderAll();
          clearSelection();
          loadFromObject(window.NetworkEditor.buildVisualizerPayload());
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      selectionDetail.appendChild(actions);
    }
  }

  function renderRelationEditForm(e) {
    selectionDetail.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'inline-edit-form';

    const typeWrap = document.createElement('div');
    typeWrap.className = 'field';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = '関係タイプ';
    typeWrap.appendChild(typeLabel);
    const typeSelect = buildFieldInput({ type: 'select', options: RELATION_TYPES, labels: RELATION_TYPE_LABELS }, e.type);
    typeWrap.appendChild(typeSelect);
    form.appendChild(typeWrap);

    const noteWrap = document.createElement('div');
    noteWrap.className = 'field';
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'メモ';
    noteWrap.appendChild(noteLabel);
    const noteInput = buildFieldInput({ type: 'textarea' }, e.note);
    noteWrap.appendChild(noteInput);
    form.appendChild(noteWrap);

    const errorEl = document.createElement('p');
    errorEl.className = 'inline-edit-error hidden';
    form.appendChild(errorEl);

    const actions = document.createElement('div');
    actions.className = 'selection-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghost-btn';
    cancelBtn.textContent = 'キャンセル';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);
    selectionDetail.appendChild(form);

    cancelBtn.addEventListener('click', () => { editingRelationId = null; renderRelationPanel(e); });
    saveBtn.addEventListener('click', () => {
      try {
        window.NetworkEditor.updateEntity('relation', e.id, {
          from_id: e.from_id, to_id: e.to_id, type: typeSelect.value,
          note: noteInput.value, source: e.source || 'manual', confidence: e.confidence || 'sure',
        });
        window.NetworkEditor.saveToStorage();
        window.NetworkEditor.renderAll();
        editingRelationId = null;
        loadFromObject(window.NetworkEditor.buildVisualizerPayload());
        const refreshed = state.edges.find(edge => edge.id === e.id);
        if (refreshed) selectRelation(refreshed);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  document.getElementById('viz-clearSelection').addEventListener('click', clearSelection);

  svg.addEventListener('click', () => {
    if (panMoved) { panMoved = false; return; }
    clearSelection();
  });

  // ------------------------------------------------------------------
  // 関係をつなぐモード（ノードを2つクリック、またはノード間をドラッグして新規関係を作成）
  // ------------------------------------------------------------------
  function setConnectMode(on) {
    connectMode = on;
    connectFromId = null;
    connectModeBtn.classList.toggle('active', connectMode);
    nodeElements.forEach(g => g.classList.remove('connect-from'));
    cancelConnectDrag();
    if (connectMode) clearSelection();
  }

  connectModeBtn.addEventListener('click', () => setConnectMode(!connectMode));

  function clientToGraph(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.scale,
      y: (clientY - rect.top - camera.y) / camera.scale,
    };
  }

  function nodeIdAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const g = el && el.closest ? el.closest('.node') : null;
    if (!g || !g.id.startsWith('node_')) return null;
    return g.id.slice('node_'.length);
  }

  function startConnectDrag(n, ev) {
    connectDragActive = true;
    connectDragMoved = false;
    connectDragStart = { x: ev.clientX, y: ev.clientY };
    connectDragWasFresh = !connectFromId;
    if (!connectFromId) {
      connectFromId = n.id;
      const g = nodeElements.get(n.id);
      if (g) g.classList.add('connect-from');
    }
    const origin = state.nodeById.get(connectFromId) || n;
    connectDragLine = document.createElementNS(SVG_NS, 'line');
    connectDragLine.setAttribute('class', 'connect-drag-line');
    connectDragLine.setAttribute('x1', origin.x);
    connectDragLine.setAttribute('y1', origin.y);
    connectDragLine.setAttribute('x2', origin.x);
    connectDragLine.setAttribute('y2', origin.y);
    viewport.appendChild(connectDragLine);
  }

  function updateConnectDrag(ev) {
    if (!connectDragActive) return;
    const dx = ev.clientX - connectDragStart.x;
    const dy = ev.clientY - connectDragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) connectDragMoved = true;
    if (!connectDragLine) return;
    const pt = clientToGraph(ev.clientX, ev.clientY);
    connectDragLine.setAttribute('x2', pt.x);
    connectDragLine.setAttribute('y2', pt.y);
  }

  // ノードを1回タップして起点を選び、別ノードへドラッグ（または続けてタップ）すると関係が作成される。
  // 起点ノードを再タップすると選択解除。
  function finishConnectDrag(ev) {
    if (!connectDragActive) return;
    connectDragActive = false;
    if (connectDragLine) { connectDragLine.remove(); connectDragLine = null; }
    const fromId = connectFromId;
    const wasFresh = connectDragWasFresh;
    if (!fromId) return;
    const toId = nodeIdAtPoint(ev.clientX, ev.clientY);

    if (toId === fromId) {
      if (wasFresh) return; // 起点を選んだだけ。ハイライトを維持して次の操作を待つ
      const g = nodeElements.get(fromId);
      if (g) g.classList.remove('connect-from');
      connectFromId = null;
      return;
    }
    if (!toId) {
      if (connectDragMoved) {
        const g = nodeElements.get(fromId);
        if (g) g.classList.remove('connect-from');
        connectFromId = null;
      }
      return;
    }
    const g = nodeElements.get(fromId);
    if (g) g.classList.remove('connect-from');
    connectFromId = null;
    openCreateRelationModal(fromId, toId);
  }

  function cancelConnectDrag() {
    if (connectDragLine) { connectDragLine.remove(); connectDragLine = null; }
    connectDragActive = false;
    connectDragMoved = false;
  }

  window.addEventListener('pointermove', updateConnectDrag);
  window.addEventListener('pointerup', finishConnectDrag);

  function openCreateRelationModal(fromId, toId) {
    const fromNode = state.nodeById.get(fromId);
    const toNode = state.nodeById.get(toId);
    document.getElementById('viz-relationModalTitle').textContent =
      `${fromNode ? fromNode.label : '?'} → ${toNode ? toNode.label : '?'} の関係を追加`;

    const typeSelect = document.getElementById('viz-relationType');
    typeSelect.innerHTML = '';
    RELATION_TYPES.forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = RELATION_TYPE_LABELS[t] || t;
      typeSelect.appendChild(o);
    });
    document.getElementById('viz-relationNote').value = '';
    const errorEl = document.getElementById('viz-relationError');
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
    relationModal.classList.remove('hidden');

    const saveBtn = document.getElementById('viz-relationSave');
    const cancelBtn = document.getElementById('viz-relationCancel');

    function cleanup() {
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      relationModal.classList.add('hidden');
    }
    function onCancel() { cleanup(); }
    function onSave() {
      try {
        window.NetworkEditor.addEntity('relation', {
          from_id: fromId, to_id: toId, type: typeSelect.value,
          note: document.getElementById('viz-relationNote').value,
          source: 'manual', confidence: 'sure',
        });
        window.NetworkEditor.saveToStorage();
        window.NetworkEditor.renderAll();
        cleanup();
        loadFromObject(window.NetworkEditor.buildVisualizerPayload());
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    }
    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
  }

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    cancelConnectDrag();
    if (connectFromId) {
      const g = nodeElements.get(connectFromId);
      if (g) g.classList.remove('connect-from');
      connectFromId = null;
    }
    relationModal.classList.add('hidden');
  });

  // ------------------------------------------------------------------
  // 検索
  // ------------------------------------------------------------------
  function renderSearchResults(matches) {
    if (!matches.length) {
      searchResults.innerHTML = '<div class="result-item">該当なし</div>';
      searchResults.classList.remove('hidden');
      return;
    }
    searchResults.innerHTML = '';
    matches.forEach(n => {
      const item = document.createElement('div');
      item.className = 'result-item';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = n.label;
      const typeSpan = document.createElement('span');
      typeSpan.className = 'result-type';
      typeSpan.textContent = n.node_type === 'owner' ? 'オーナー' : '店舗';
      item.appendChild(nameSpan);
      item.appendChild(typeSpan);
      item.addEventListener('click', () => {
        selectNode(n);
        centerOnNode(n);
        searchResults.classList.add('hidden');
        searchBox.value = n.label;
      });
      searchResults.appendChild(item);
    });
    searchResults.classList.remove('hidden');
  }

  searchBox.addEventListener('input', () => {
    const q = searchBox.value.trim().toLowerCase();
    if (!q) { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; return; }
    const matches = state.nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 20);
    renderSearchResults(matches);
  });

  document.addEventListener('click', ev => {
    if (!ev.target.closest('.toolbar-search')) searchResults.classList.add('hidden');
  });

  // ------------------------------------------------------------------
  // フィルタ
  // ------------------------------------------------------------------
  function populateFilters() {
    const areas = Array.from(new Set(state.nodes.map(n => n.area).filter(Boolean))).sort();
    const groups = Array.from(new Set(state.nodes.map(n => n.group).filter(Boolean))).sort();

    areaFilterSelect.innerHTML = '<option value="全体">全体</option>' +
      areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    groupFilterSelect.innerHTML = '<option value="全て表示">全て表示</option>' +
      groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  }

  function isNodeVisible(n) {
    const area = areaFilterSelect.value;
    const group = groupFilterSelect.value;
    const areaOk = area === '全体' || n.area === area;
    const groupOk = group === '全て表示' || n.group === group;
    return areaOk && groupOk;
  }

  function groupColor(group) {
    let hash = 0;
    for (let i = 0; i < group.length; i++) hash = (hash * 31 + group.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 45%)`;
  }

  function applyFilters() {
    if (selectedNodeId || selectedRelationId) return; // 選択中はハイライト表示を優先
    const mode = visibilityModeSelect.value;
    const group = groupFilterSelect.value;

    state.nodes.forEach(n => {
      const el = nodeElements.get(n.id);
      if (!el) return;
      const visible = isNodeVisible(n);
      el.style.display = (!visible && mode === 'hide') ? 'none' : '';
      el.style.opacity = visible ? '1' : '0.2';

      const circle = el.querySelector('circle:not(.hit-area)');
      if (group !== '全て表示' && n.group === group) {
        circle.style.stroke = groupColor(group);
        circle.style.strokeWidth = '3';
      } else {
        circle.style.stroke = '';
        circle.style.strokeWidth = '';
      }
    });

    state.edges.forEach(e => {
      const el = edgeElements.get(edgeKey(e));
      if (!el) return;
      const from = state.nodeById.get(e.from_id);
      const to = state.nodeById.get(e.to_id);
      const visible = from && to && isNodeVisible(from) && isNodeVisible(to);
      el.style.display = (!visible && mode === 'hide') ? 'none' : '';
      el.style.opacity = visible ? '1' : '0.2';
    });
  }

  function updateStats() {
    statOwners.textContent = state.nodes.filter(n => n.node_type === 'owner').length;
    statShops.textContent = state.nodes.filter(n => n.node_type === 'shop').length;
    statRelations.textContent = state.edges.filter(e => e.type !== 'owner_shop').length;
  }

  areaFilterSelect.addEventListener('change', () => { clearSelection(); applyFilters(); renderRegionBoxes(); });
  groupFilterSelect.addEventListener('change', () => { clearSelection(); applyFilters(); renderRegionBoxes(); });
  visibilityModeSelect.addEventListener('change', () => { applyFilters(); renderRegionBoxes(); });

  // ------------------------------------------------------------------
  // ズーム・パン
  // ------------------------------------------------------------------
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${camera.x}, ${camera.y}) scale(${camera.scale})`);
    zoomPercentEl.textContent = Math.round(camera.scale * 100) + '%';
    if (nodesGroup) {
      const showLabels = camera.scale >= 0.5 && !dragSimplified;
      nodesGroup.querySelectorAll('text').forEach(t => t.style.display = showLabels ? '' : 'none');
    }
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = svg.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const newScale = clamp(camera.scale * factor, 0.5, 3);
    const actualFactor = newScale / camera.scale;
    camera.x = mouseX - (mouseX - camera.x) * actualFactor;
    camera.y = mouseY - (mouseY - camera.y) * actualFactor;
    camera.scale = newScale;
    applyTransform();
  }

  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(ev.clientX, ev.clientY, factor);
  }, { passive: false });

  document.getElementById('viz-zoomIn').addEventListener('click', () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.1);
  });
  document.getElementById('viz-zoomOut').addEventListener('click', () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.1);
  });
  document.getElementById('viz-fitButton').addEventListener('click', () => fitView(true));

  svg.addEventListener('mousedown', ev => {
    if (ev.button !== 0 || draggingNode) return;
    isPanning = true;
    panMoved = false;
    panStart = { x: ev.clientX, y: ev.clientY };
    cameraStart = { x: camera.x, y: camera.y };
    svg.classList.add('grabbing');
  });

  window.addEventListener('mousemove', ev => {
    if (draggingNode) {
      const dx = (ev.clientX - nodeDragStart.x) / camera.scale;
      const dy = (ev.clientY - nodeDragStart.y) / camera.scale;
      if (Math.abs(ev.clientX - nodeDragStart.x) > 2 || Math.abs(ev.clientY - nodeDragStart.y) > 2) {
        nodeDragMoved = true;
      }
      draggingNode.x = nodeStartPos.x + dx;
      draggingNode.y = nodeStartPos.y + dy;
      const g = nodeElements.get(draggingNode.id);
      if (g) g.setAttribute('transform', `translate(${draggingNode.x}, ${draggingNode.y})`);
      updateEdgePositionsForNode(draggingNode.id);
      renderRegionBoxes();
      return;
    }

    if (!isPanning) return;
    const dx = ev.clientX - panStart.x;
    const dy = ev.clientY - panStart.y;
    if ((Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      panMoved = true;
      if (!dragSimplified) {
        dragSimplified = true;
        applyTransform();
      }
    }
    camera.x = cameraStart.x + dx;
    camera.y = cameraStart.y + dy;
    applyTransform();
  });

  // ドラッグしたノードを別のノードに重ねて離すと、関係作成モーダルを開く
  // （「関係をつなぐ」モードに切り替えなくても直感的に関係を作れるようにするための近道）
  function findOverlapTarget(n) {
    let best = null;
    let bestDist = Infinity;
    state.nodes.forEach(other => {
      if (other.id === n.id || !isNodeVisible(other)) return;
      const dx = other.x - n.x;
      const dy = other.y - n.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const threshold = (nodeRadius(n) + nodeRadius(other)) * 0.7;
      if (dist < threshold && dist < bestDist) {
        best = other;
        bestDist = dist;
      }
    });
    return best;
  }

  window.addEventListener('mouseup', () => {
    if (draggingNode) {
      const g = nodeElements.get(draggingNode.id);
      if (g) g.classList.remove('dragging');
      if (nodeDragMoved) {
        draggingNode.pos_x = draggingNode.x;
        draggingNode.pos_y = draggingNode.y;
        renderRegionBoxes();
        if (hasEditorBridge()) {
          window.NetworkEditor.setNodePosition(draggingNode.id, draggingNode.pos_x, draggingNode.pos_y);
          window.NetworkEditor.renderAll();
        }
        const overlapTarget = findOverlapTarget(draggingNode);
        if (overlapTarget) {
          openCreateRelationModal(draggingNode.id, overlapTarget.id);
        }
      }
      draggingNode = null;
      return;
    }
    if (!isPanning) return;
    isPanning = false;
    svg.classList.remove('grabbing');
    if (dragSimplified) {
      dragSimplified = false;
      applyTransform();
    }
  });

  function animateCamera(target, duration) {
    const start = { ...camera };
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      camera.scale = start.scale + (target.scale - start.scale) * ease;
      camera.x = start.x + (target.x - start.x) * ease;
      camera.y = start.y + (target.y - start.y) * ease;
      applyTransform();
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function centerOnNode(n) {
    const targetScale = 1.5;
    const rect = svg.getBoundingClientRect();
    animateCamera({
      scale: targetScale,
      x: rect.width / 2 - n.x * targetScale,
      y: rect.height / 2 - n.y * targetScale,
    }, 300);
  }

  function fitView(animated) {
    const visible = state.nodes.filter(isNodeVisible);
    const targets = visible.length ? visible : state.nodes;
    if (!targets.length) {
      animateCamera({ scale: 1, x: 0, y: 0 }, animated ? 300 : 0);
      return;
    }
    const xs = targets.map(n => n.x);
    const ys = targets.map(n => n.y);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    const rect = svg.getBoundingClientRect();
    const scale = clamp(Math.min(rect.width / (maxX - minX || 1), rect.height / (maxY - minY || 1)), 0.5, 3);
    const target = {
      scale,
      x: rect.width / 2 - (minX + maxX) / 2 * scale,
      y: rect.height / 2 - (minY + maxY) / 2 * scale,
    };
    if (animated) animateCamera(target, 300);
    else { camera.scale = target.scale; camera.x = target.x; camera.y = target.y; applyTransform(); }
  }

  // ------------------------------------------------------------------
  // 保存（SVG / PNG）
  // ------------------------------------------------------------------
  function buildExportSvg() {
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', rect.width);
    clone.setAttribute('height', rect.height);
    clone.setAttribute('xmlns', SVG_NS);

    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = `
      .node.owner circle { fill: #2ea043; stroke-width: 2; }
      .node.shop circle { fill: #2f6fed; stroke-width: 2; }
      .node text { font-size: 11px; font-family: sans-serif; }
      .edge { stroke: #9aa3af; fill: none; }
      .edge.owner_shop { stroke-width: 1; }
      .edge.same_building { stroke: #eb6834; stroke-width: 2.5; }
      .edge.family { stroke: #1baf7a; stroke-width: 2; stroke-dasharray: 7 4; }
      .edge.business { stroke: #eda100; stroke-width: 3.5; }
      .edge.other { stroke: #e87ba4; stroke-width: 2; stroke-dasharray: 1 4; stroke-linecap: round; }
    `;
    clone.insertBefore(style, clone.firstChild);
    return clone;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('viz-saveSvg').addEventListener('click', () => {
    const clone = buildExportSvg();
    const xml = new XMLSerializer().serializeToString(clone);
    downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), 'network.svg');
  });

  document.getElementById('viz-savePng').addEventListener('click', () => {
    const clone = buildExportSvg();
    const rect = svg.getBoundingClientRect();
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => downloadBlob(blob, 'network.png'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  // ------------------------------------------------------------------
  // ガイド
  // ------------------------------------------------------------------
  document.getElementById('viz-guideButton').addEventListener('click', () => guideModal.classList.remove('hidden'));
  document.getElementById('viz-closeGuide').addEventListener('click', () => guideModal.classList.add('hidden'));
  guideModal.addEventListener('click', e => { if (e.target === guideModal) guideModal.classList.add('hidden'); });

  // ------------------------------------------------------------------
  // 初期化
  // ------------------------------------------------------------------
  window.addEventListener('resize', () => applyTransform());
  applyTransform();

  // ?data=path/to/network.json クエリ（file://で開いた場合は動作しない点に注意）
  const params = new URLSearchParams(window.location.search);
  const dataPath = params.get('data');
  if (dataPath) {
    fetch(dataPath)
      .then(r => r.json())
      .then(loadFromObject)
      .catch(err => console.warn('?data クエリでの読み込みに失敗しました（file://で開いている場合はサーバー経由で開いてください）:', err));
  }

  window.NetworkVisualizer = {
    loadFromObject,
    fitView,
  };
})();
