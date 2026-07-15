// 飲食店ネットワーク相関図 - ズーム対応表示ツール
// 入力データは manager.py --action export_for_html が出力する
// { metadata, nodes: [{id,label,node_type,area,group,genre,confidence}],
//   edges: [{from_id,to_id,type,confidence}] } 形式を前提とする。

(() => {
  const RELATION_TYPES = ['owner_shop', 'same_building', 'family', 'business', 'other'];

  const svg = document.getElementById('graph');
  const viewport = document.getElementById('viewport');
  const dropZone = document.getElementById('dropZone');
  const tooltip = document.getElementById('tooltip');
  const zoomPercentEl = document.getElementById('zoomPercent');
  const areaFilterSelect = document.getElementById('areaFilter');
  const groupFilterSelect = document.getElementById('groupFilter');
  const visibilityModeSelect = document.getElementById('visibilityMode');
  const statOwners = document.getElementById('statOwners');
  const statShops = document.getElementById('statShops');
  const statRelations = document.getElementById('statRelations');
  const guideModal = document.getElementById('guideModal');

  let edgesGroup = null;
  let nodesGroup = null;

  const camera = { scale: 1.0, x: 0, y: 0 };
  const state = { nodes: [], edges: [], nodeById: new Map() };
  const nodeElements = new Map();
  const edgeElements = new Map();

  let isDragging = false;
  let dragMoved = false;
  let dragStart = { x: 0, y: 0 };
  let cameraStart = { x: 0, y: 0 };
  let dragSimplified = false;

  // ------------------------------------------------------------------
  // データ読み込み
  // ------------------------------------------------------------------
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

    dropZone.classList.add('hidden');
    simulateLayout(state.nodes, state.edges);
    populateFilters();
    render();
    fitView(false);
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

  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadFile(file);
  });

  const canvasWrap = document.getElementById('canvasWrap');
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
  // レイアウト（簡易 Fruchterman-Reingold）
  // ------------------------------------------------------------------
  function simulateLayout(nodes, edges) {
    const width = 1200;
    const height = 800;
    if (nodes.length === 0) return;

    const area = width * height;
    const k = Math.sqrt(area / nodes.length) * 0.9;
    const iterations = nodes.length > 500 ? 30 : 300;
    const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));

    nodes.forEach(n => {
      n.x = Math.random() * width;
      n.y = Math.random() * height;
    });

    let temperature = width / 10;

    for (let iter = 0; iter < iterations; iter++) {
      const disp = nodes.map(() => ({ x: 0, y: 0 }));

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const force = (k * k) / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp[i].x += fx; disp[i].y += fy;
          disp[j].x -= fx; disp[j].y -= fy;
        }
      }

      edges.forEach(e => {
        const i = idToIndex.get(e.from_id);
        const j = idToIndex.get(e.to_id);
        if (i === undefined || j === undefined) return;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[i].x -= fx; disp[i].y -= fy;
        disp[j].x += fx; disp[j].y += fy;
      });

      for (let i = 0; i < nodes.length; i++) {
        const dx = disp[i].x;
        const dy = disp[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const capped = Math.min(dist, temperature);
        nodes[i].x += (dx / dist) * capped;
        nodes[i].y += (dy / dist) * capped;
        nodes[i].x = Math.min(width, Math.max(0, nodes[i].x));
        nodes[i].y = Math.min(height, Math.max(0, nodes[i].y));
      }

      temperature *= 0.97;
    }
  }

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

    edgesGroup = document.createElementNS(SVG_NS, 'g');
    edgesGroup.setAttribute('id', 'edges');
    nodesGroup = document.createElementNS(SVG_NS, 'g');
    nodesGroup.setAttribute('id', 'nodes');
    viewport.appendChild(edgesGroup);
    viewport.appendChild(nodesGroup);

    state.edges.forEach(e => {
      const from = state.nodeById.get(e.from_id);
      const to = state.nodeById.get(e.to_id);
      if (!from || !to) return;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', `edge ${e.type}`);
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      line.addEventListener('mouseenter', ev => showTooltip(ev, `関係: ${e.type}\n信頼度: ${e.confidence || '-'}`));
      line.addEventListener('mousemove', moveTooltip);
      line.addEventListener('mouseleave', hideTooltip);
      edgesGroup.appendChild(line);
      edgeElements.set(edgeKey(e), line);
    });

    state.nodes.forEach(n => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `node ${n.node_type}`);
      g.setAttribute('id', `node_${n.id}`);
      g.setAttribute('transform', `translate(${n.x}, ${n.y})`);

      const hitArea = document.createElementNS(SVG_NS, 'circle');
      hitArea.setAttribute('r', 16);
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('class', 'hit-area');
      g.appendChild(hitArea);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', n.node_type === 'owner' ? 10 : 7);
      g.appendChild(circle);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', n.node_type === 'owner' ? 13 : 10);
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
        showTooltip(ev, lines.join('\n'));
      });
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', hideTooltip);
      g.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        centerOnNode(n);
      });

      nodeElements.set(n.id, g);
    });

    applyFilters();
    updateStats();
  }

  function updateEdgePositions() {
    state.edges.forEach(e => {
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
  // ツールチップ
  // ------------------------------------------------------------------
  function showTooltip(ev, text) {
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    moveTooltip(ev);
  }
  function moveTooltip(ev) {
    const wrapRect = canvasWrap.getBoundingClientRect();
    tooltip.style.left = (ev.clientX - wrapRect.left + 12) + 'px';
    tooltip.style.top = (ev.clientY - wrapRect.top + 12) + 'px';
  }
  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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
    const mode = visibilityModeSelect.value;
    const group = groupFilterSelect.value;

    state.nodes.forEach(n => {
      const el = nodeElements.get(n.id);
      if (!el) return;
      const visible = isNodeVisible(n);
      el.style.display = (!visible && mode === 'hide') ? 'none' : '';
      el.style.opacity = visible ? '1' : '0.2';

      const circle = el.querySelector('circle');
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

  areaFilterSelect.addEventListener('change', applyFilters);
  groupFilterSelect.addEventListener('change', applyFilters);
  visibilityModeSelect.addEventListener('change', applyFilters);

  // ------------------------------------------------------------------
  // ズーム・パン
  // ------------------------------------------------------------------
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${camera.x}, ${camera.y}) scale(${camera.scale})`);
    zoomPercentEl.textContent = Math.round(camera.scale * 100) + '%';
    nodesGroup && nodesGroup.classList.toggle('low-zoom', camera.scale < 0.5);
    if (camera.scale < 0.5) {
      nodesGroup && nodesGroup.querySelectorAll('text').forEach(t => t.style.display = 'none');
    } else {
      nodesGroup && nodesGroup.querySelectorAll('text').forEach(t => t.style.display = '');
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

  document.getElementById('zoomIn').addEventListener('click', () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.1);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.1);
  });
  document.getElementById('fitButton').addEventListener('click', () => fitView(true));

  svg.addEventListener('mousedown', ev => {
    if (ev.button !== 0) return;
    isDragging = true;
    dragMoved = false;
    dragStart = { x: ev.clientX, y: ev.clientY };
    cameraStart = { x: camera.x, y: camera.y };
    svg.classList.add('grabbing');
  });
  window.addEventListener('mousemove', ev => {
    if (!isDragging) return;
    const dx = ev.clientX - dragStart.x;
    const dy = ev.clientY - dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragMoved = true;
      if (!dragSimplified) {
        dragSimplified = true;
        nodesGroup && nodesGroup.querySelectorAll('text').forEach(t => t.style.display = 'none');
      }
    }
    camera.x = cameraStart.x + dx;
    camera.y = cameraStart.y + dy;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
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
      .edge.same_building { stroke-width: 2; }
      .edge.family { stroke-width: 1.5; stroke-dasharray: 6 4; }
      .edge.business { stroke-width: 3; }
      .edge.other { stroke-width: 1.5; stroke-dasharray: 2 3; }
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

  document.getElementById('saveSvg').addEventListener('click', () => {
    const clone = buildExportSvg();
    const xml = new XMLSerializer().serializeToString(clone);
    downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), 'network.svg');
  });

  document.getElementById('savePng').addEventListener('click', () => {
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
  document.getElementById('guideButton').addEventListener('click', () => guideModal.classList.remove('hidden'));
  document.getElementById('closeGuide').addEventListener('click', () => guideModal.classList.add('hidden'));
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
})();
