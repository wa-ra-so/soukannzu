// 飲食店ネットワーク データ入力ページ
// manager.py の生データ形式 { metadata, owners:[], shops:[], relations:[] } を
// ブラウザ内(localStorage)で編集し、JSONの読み込み/ダウンロードを行う。
// サーバーは不要。バリデーションルールは manager.py の validate() に準拠。

const VALID_SOURCES = ['manual', 'web', 'lcdb'];
const VALID_CONFIDENCE = ['sure', 'medium', 'low'];
const VALID_RELATION_TYPES = ['same_building', 'family', 'business', 'other'];
const STORAGE_KEY = 'network-editor-data-v1';

const FIELD_SPECS = {
  owner: [
    { key: 'name', label: '名前', type: 'text', required: true },
    { key: 'area', label: 'エリア', type: 'text', required: true },
    { key: 'group', label: 'グループ', type: 'text' },
    { key: 'note', label: 'メモ', type: 'textarea' },
    { key: 'source', label: 'ソース', type: 'select', options: VALID_SOURCES, default: 'manual' },
    { key: 'confidence', label: '信頼度', type: 'select', options: VALID_CONFIDENCE, default: 'sure' },
  ],
  shop: [
    { key: 'name', label: '名前', type: 'text', required: true },
    { key: 'genre', label: 'ジャンル', type: 'text' },
    { key: 'owner_id', label: 'オーナー', type: 'owner-select', required: true },
    { key: 'area', label: 'エリア', type: 'text', required: true },
    { key: 'group', label: 'グループ', type: 'text' },
    { key: 'address', label: '住所', type: 'text' },
    { key: 'tabelog_url', label: '食べログURL', type: 'text' },
    { key: 'source', label: 'ソース', type: 'select', options: VALID_SOURCES, default: 'manual' },
    { key: 'confidence', label: '信頼度', type: 'select', options: VALID_CONFIDENCE, default: 'sure' },
  ],
  relation: [
    { key: 'from_id', label: 'From', type: 'node-select', required: true },
    { key: 'to_id', label: 'To', type: 'node-select', required: true },
    { key: 'type', label: '関係タイプ', type: 'select', options: VALID_RELATION_TYPES, required: true },
    { key: 'note', label: 'メモ', type: 'textarea' },
    { key: 'source', label: 'ソース', type: 'select', options: ['manual', 'web'], default: 'manual' },
    { key: 'confidence', label: '信頼度', type: 'select', options: VALID_CONFIDENCE, default: 'sure' },
  ],
};

const ADD_TITLES = { owner: 'オーナーを追加', shop: '店舗を追加', relation: '関係を追加' };
const EDIT_TITLES = { owner: 'オーナーを編集', shop: '店舗を編集', relation: '関係を編集' };

let data = loadFromStorage() || initData();
let currentKind = null;
let currentEditId = null;

function initData() {
  return {
    metadata: { updated_at: new Date().toISOString(), area: 'Chiba', version: '1.0' },
    owners: [],
    shops: [],
    relations: [],
  };
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return null;
}

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota / private mode */ }
}

function genId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function findNodeById(id) {
  return data.owners.find(o => o.id === id) || data.shops.find(s => s.id === id);
}

function allNodesForSelect() {
  return [
    ...data.owners.map(o => ({ id: o.id, label: o.name, type: 'owner' })),
    ...data.shops.map(s => ({ id: s.id, label: s.name, type: 'shop' })),
  ];
}

// ------------------------------------------------------------------
// バリデーション（追加・更新時: 最初の違反を例外で投げる）
// ------------------------------------------------------------------
function validateOwnerInput(values) {
  if (!values.name || !values.name.trim()) throw new Error('名前は必須です');
  if (!values.area || !values.area.trim()) throw new Error('エリアは必須です');
}

function validateShopInput(values) {
  if (!values.name || !values.name.trim()) throw new Error('名前は必須です');
  if (!values.area || !values.area.trim()) throw new Error('エリアは必須です');
  if (!values.owner_id) throw new Error('オーナーを選択してください');
  if (!data.owners.some(o => o.id === values.owner_id)) throw new Error('選択したオーナーが見つかりません');
}

function validateRelationInput(values, editingId) {
  if (!values.from_id || !values.to_id) throw new Error('FromとToを選択してください');
  if (values.from_id === values.to_id) throw new Error('FromとToに同じノードは指定できません');
  if (!findNodeById(values.from_id)) throw new Error('Fromのノードが見つかりません');
  if (!findNodeById(values.to_id)) throw new Error('Toのノードが見つかりません');
  if (!VALID_RELATION_TYPES.includes(values.type)) throw new Error('関係タイプを選択してください');
  const pairKey = [values.from_id, values.to_id].sort().join('|');
  const dup = data.relations.find(r => r.id !== editingId && [r.from_id, r.to_id].sort().join('|') === pairKey);
  if (dup) throw new Error('この組み合わせの関係は既に登録されています');
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------
function findEntity(kind, id) {
  if (kind === 'owner') return data.owners.find(o => o.id === id);
  if (kind === 'shop') return data.shops.find(s => s.id === id);
  if (kind === 'relation') return data.relations.find(r => r.id === id);
}

function addEntity(kind, values) {
  if (kind === 'owner') {
    validateOwnerInput(values);
    data.owners.push({
      id: genId('owner'), name: values.name.trim(), area: values.area.trim(),
      group: values.group || '', note: values.note || '',
      source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  } else if (kind === 'shop') {
    validateShopInput(values);
    data.shops.push({
      id: genId('shop'), name: values.name.trim(), genre: values.genre || '',
      owner_id: values.owner_id, area: values.area.trim(), group: values.group || '',
      address: values.address || '', tabelog_url: values.tabelog_url || '',
      source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  } else if (kind === 'relation') {
    validateRelationInput(values, null);
    data.relations.push({
      id: genId('rel'), from_id: values.from_id, to_id: values.to_id, type: values.type,
      note: values.note || '', source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  }
}

function updateEntity(kind, id, values) {
  if (kind === 'owner') {
    validateOwnerInput(values);
    Object.assign(findEntity('owner', id), {
      name: values.name.trim(), area: values.area.trim(), group: values.group || '',
      note: values.note || '', source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  } else if (kind === 'shop') {
    validateShopInput(values);
    Object.assign(findEntity('shop', id), {
      name: values.name.trim(), genre: values.genre || '', owner_id: values.owner_id,
      area: values.area.trim(), group: values.group || '', address: values.address || '',
      tabelog_url: values.tabelog_url || '', source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  } else if (kind === 'relation') {
    validateRelationInput(values, id);
    Object.assign(findEntity('relation', id), {
      from_id: values.from_id, to_id: values.to_id, type: values.type,
      note: values.note || '', source: values.source || 'manual', confidence: values.confidence || 'sure',
    });
  }
}

function deleteOwner(id) {
  const dependentShops = data.shops.filter(s => s.owner_id === id);
  if (dependentShops.length) {
    const ok = confirm(`このオーナーには${dependentShops.length}件の店舗が紐づいています。店舗と関連する関係もまとめて削除しますか？`);
    if (!ok) return false;
    dependentShops.forEach(s => removeShopCascade(s.id));
  }
  data.relations = data.relations.filter(r => r.from_id !== id && r.to_id !== id);
  data.owners = data.owners.filter(o => o.id !== id);
  return true;
}

function removeShopCascade(id) {
  data.relations = data.relations.filter(r => r.from_id !== id && r.to_id !== id);
  data.shops = data.shops.filter(s => s.id !== id);
}

function deleteShop(id) {
  const ok = confirm('この店舗を削除しますか？関連する関係も削除されます。');
  if (!ok) return false;
  removeShopCascade(id);
  return true;
}

function deleteRelation(id) {
  const ok = confirm('この関係を削除しますか？');
  if (!ok) return false;
  data.relations = data.relations.filter(r => r.id !== id);
  return true;
}

// ------------------------------------------------------------------
// 検証（manager.py の validate() 相当のフルレポート）
// ------------------------------------------------------------------
function runValidation() {
  const errors = [];
  const warnings = [];
  const ownerIds = data.owners.map(o => o.id);
  const shopIds = data.shops.map(s => s.id);
  const relationIds = data.relations.map(r => r.id);

  [['owner', ownerIds], ['shop', shopIds], ['relation', relationIds]].forEach(([label, ids]) => {
    const counts = {};
    ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    Object.entries(counts).filter(([, c]) => c > 1).forEach(([id]) => errors.push(`重複した${label} id: ${id}`));
  });

  const nodeIds = new Set([...ownerIds, ...shopIds]);

  data.owners.forEach(o => {
    if (!o.name || !o.name.trim()) errors.push(`オーナー ${o.id}: 名前が空です`);
    if (!o.area || !o.area.trim()) errors.push(`オーナー ${o.id}: エリアが空です`);
    if (!VALID_SOURCES.includes(o.source)) errors.push(`オーナー "${o.name}": 不正なsource "${o.source}"`);
    if (!VALID_CONFIDENCE.includes(o.confidence)) errors.push(`オーナー "${o.name}": 不正なconfidence "${o.confidence}"`);
    else if (o.confidence === 'sure' && ['web', 'lcdb'].includes(o.source)) {
      warnings.push(`オーナー "${o.name}": confidenceがsureなのにsourceが${o.source}です`);
    }
  });

  data.shops.forEach(s => {
    if (!s.name || !s.name.trim()) errors.push(`店舗 ${s.id}: 名前が空です`);
    if (!s.area || !s.area.trim()) errors.push(`店舗 ${s.id}: エリアが空です`);
    if (!ownerIds.includes(s.owner_id)) errors.push(`店舗 "${s.name}": owner_id "${s.owner_id}" が存在しません`);
    if (!VALID_SOURCES.includes(s.source)) errors.push(`店舗 "${s.name}": 不正なsource "${s.source}"`);
    if (!VALID_CONFIDENCE.includes(s.confidence)) errors.push(`店舗 "${s.name}": 不正なconfidence "${s.confidence}"`);
    else if (s.confidence === 'sure' && ['web', 'lcdb'].includes(s.source)) {
      warnings.push(`店舗 "${s.name}": confidenceがsureなのにsourceが${s.source}です`);
    }
  });

  const seenPairs = new Map();
  data.relations.forEach(r => {
    if (r.from_id === r.to_id) errors.push(`関係 ${r.id}: from_idとto_idが同じです`);
    if (!nodeIds.has(r.from_id)) errors.push(`関係 ${r.id}: from_id "${r.from_id}" が存在しません`);
    if (!nodeIds.has(r.to_id)) errors.push(`関係 ${r.id}: to_id "${r.to_id}" が存在しません`);
    if (!VALID_RELATION_TYPES.includes(r.type)) errors.push(`関係 ${r.id}: 不正なtype "${r.type}"`);
    if (!VALID_SOURCES.includes(r.source)) errors.push(`関係 ${r.id}: 不正なsource "${r.source}"`);
    if (!VALID_CONFIDENCE.includes(r.confidence)) errors.push(`関係 ${r.id}: 不正なconfidence "${r.confidence}"`);
    const pairKey = [r.from_id, r.to_id].sort().join('|');
    if (seenPairs.has(pairKey)) errors.push(`関係 ${r.id}: ${seenPairs.get(pairKey)} と重複する関係です`);
    else seenPairs.set(pairKey, r.id);
  });

  return { errors, warnings };
}

function showValidationModal() {
  const { errors, warnings } = runValidation();
  const body = document.getElementById('validationBody');
  if (!errors.length && !warnings.length) {
    body.innerHTML = '<p class="validation-ok">✅ 問題は見つかりませんでした</p>';
  } else {
    let html = '';
    if (errors.length) {
      html += `<h3>エラー (${errors.length})</h3><ul>${errors.map(e => `<li class="error">${escapeHtml(e)}</li>`).join('')}</ul>`;
    }
    if (warnings.length) {
      html += `<h3>警告 (${warnings.length})</h3><ul>${warnings.map(w => `<li class="warning">${escapeHtml(w)}</li>`).join('')}</ul>`;
    }
    body.innerHTML = html;
  }
  document.getElementById('validationModal').classList.remove('hidden');
}

// ------------------------------------------------------------------
// フォーム描画
// ------------------------------------------------------------------
function renderForm(specs, values) {
  const form = document.getElementById('entityForm');
  form.innerHTML = '';
  specs.forEach(spec => {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.textContent = spec.label;
    if (spec.required) label.classList.add('required');
    label.htmlFor = 'field_' + spec.key;
    wrap.appendChild(label);

    let input;
    if (spec.type === 'select') {
      input = document.createElement('select');
      spec.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else if (spec.type === 'owner-select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '選択してください';
      input.appendChild(blank);
      data.owners.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${o.name}（${o.area}）`;
        input.appendChild(opt);
      });
    } else if (spec.type === 'node-select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '選択してください';
      input.appendChild(blank);
      allNodesForSelect().forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = `${n.label}（${n.type === 'owner' ? 'オーナー' : '店舗'}）`;
        input.appendChild(opt);
      });
    } else if (spec.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }

    input.id = 'field_' + spec.key;
    input.name = spec.key;
    const value = values[spec.key] !== undefined && values[spec.key] !== null ? values[spec.key] : (spec.default || '');
    input.value = value;
    wrap.appendChild(input);
    form.appendChild(wrap);
  });
}

function collectFormValues(specs) {
  const values = {};
  specs.forEach(spec => {
    values[spec.key] = document.getElementById('field_' + spec.key).value;
  });
  return values;
}

function showFormError(message) {
  const el = document.getElementById('formError');
  el.textContent = message;
  el.classList.remove('hidden');
}
function hideFormError() {
  document.getElementById('formError').classList.add('hidden');
}

function openAddModal(kind) {
  currentKind = kind;
  currentEditId = null;
  document.getElementById('formTitle').textContent = ADD_TITLES[kind];
  renderForm(FIELD_SPECS[kind], {});
  hideFormError();
  document.getElementById('formModal').classList.remove('hidden');
  document.getElementById('field_' + FIELD_SPECS[kind][0].key).focus();
}

function openEditModal(kind, id) {
  currentKind = kind;
  currentEditId = id;
  const entity = findEntity(kind, id);
  document.getElementById('formTitle').textContent = EDIT_TITLES[kind];
  renderForm(FIELD_SPECS[kind], entity);
  hideFormError();
  document.getElementById('formModal').classList.remove('hidden');
}

function closeFormModal() {
  document.getElementById('formModal').classList.add('hidden');
}

document.getElementById('formCancel').addEventListener('click', closeFormModal);
document.getElementById('formModal').addEventListener('click', e => {
  if (e.target.id === 'formModal') closeFormModal();
});

document.getElementById('formSubmit').addEventListener('click', () => {
  const values = collectFormValues(FIELD_SPECS[currentKind]);
  try {
    if (currentEditId) updateEntity(currentKind, currentEditId, values);
    else addEntity(currentKind, values);
    saveToStorage();
    renderAll();
    closeFormModal();
  } catch (err) {
    showFormError(err.message);
  }
});

document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => openAddModal(btn.dataset.add));
});

document.getElementById('validateBtn').addEventListener('click', showValidationModal);
document.getElementById('validationClose').addEventListener('click', () => {
  document.getElementById('validationModal').classList.add('hidden');
});
document.getElementById('validationModal').addEventListener('click', e => {
  if (e.target.id === 'validationModal') document.getElementById('validationModal').classList.add('hidden');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFormModal();
    document.getElementById('validationModal').classList.add('hidden');
  }
});

// ------------------------------------------------------------------
// タブ切り替え
// ------------------------------------------------------------------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('.table-search').forEach(input => {
  input.addEventListener('input', renderAll);
});

function getSearchValue(kind) {
  const el = document.querySelector(`.table-search[data-for="${kind}"]`);
  return el ? el.value.trim().toLowerCase() : '';
}

// ------------------------------------------------------------------
// テーブル描画
// ------------------------------------------------------------------
function confidenceBadge(entity) {
  const mismatch = entity.confidence === 'sure' && (entity.source === 'web' || entity.source === 'lcdb');
  const cls = mismatch ? 'warn-mismatch' : `confidence-${entity.confidence}`;
  const label = mismatch ? `${entity.confidence} ⚠️` : entity.confidence;
  const title = mismatch ? 'confidenceがsureなのにsourceが推測(web/lcdb)です' : '';
  return `<span class="badge ${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function setEmptyState(kind, isEmpty) {
  document.getElementById('table-' + kind).closest('.table-wrap').classList.toggle('empty', isEmpty);
}

function renderOwnersTable() {
  const tbody = document.querySelector('#table-owners tbody');
  tbody.innerHTML = '';
  const q = getSearchValue('owners');
  const filtered = data.owners.filter(o => !q || [o.name, o.area, o.group].some(v => (v || '').toLowerCase().includes(q)));

  filtered.forEach(o => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(o.name)}</td>
      <td>${escapeHtml(o.area)}</td>
      <td>${escapeHtml(o.group || '-')}</td>
      <td title="${escapeHtml(o.note || '')}">${escapeHtml(truncate(o.note, 24) || '-')}</td>
      <td><span class="badge">${escapeHtml(o.source)}</span></td>
      <td>${confidenceBadge(o)}</td>
    `;
    const tdActions = document.createElement('td');
    tdActions.className = 'row-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openEditModal('owner', o.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.className = 'delete';
    delBtn.addEventListener('click', () => { if (deleteOwner(o.id)) { saveToStorage(); renderAll(); } });
    tdActions.appendChild(editBtn);
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  if (!filtered.length && data.owners.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">該当するオーナーがありません</td></tr>';
  }
  setEmptyState('owners', data.owners.length === 0);
}

function renderShopsTable() {
  const tbody = document.querySelector('#table-shops tbody');
  tbody.innerHTML = '';
  const q = getSearchValue('shops');
  const filtered = data.shops.filter(s => !q || [s.name, s.area, s.genre].some(v => (v || '').toLowerCase().includes(q)));

  filtered.forEach(s => {
    const owner = data.owners.find(o => o.id === s.owner_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.genre || '-')}</td>
      <td>${owner ? escapeHtml(owner.name) : '<span class="badge warn-mismatch">不明</span>'}</td>
      <td>${escapeHtml(s.area)}</td>
      <td>${escapeHtml(s.group || '-')}</td>
      <td><span class="badge">${escapeHtml(s.source)}</span></td>
      <td>${confidenceBadge(s)}</td>
    `;
    const tdActions = document.createElement('td');
    tdActions.className = 'row-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openEditModal('shop', s.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.className = 'delete';
    delBtn.addEventListener('click', () => { if (deleteShop(s.id)) { saveToStorage(); renderAll(); } });
    tdActions.appendChild(editBtn);
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  if (!filtered.length && data.shops.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">該当する店舗がありません</td></tr>';
  }
  setEmptyState('shops', data.shops.length === 0);
}

function renderRelationsTable() {
  const tbody = document.querySelector('#table-relations tbody');
  tbody.innerHTML = '';
  const q = getSearchValue('relations');
  const filtered = data.relations.filter(r => {
    if (!q) return true;
    const fromLabel = (findNodeById(r.from_id) || {}).name || '';
    const toLabel = (findNodeById(r.to_id) || {}).name || '';
    return [fromLabel, toLabel, r.type].some(v => (v || '').toLowerCase().includes(q));
  });

  filtered.forEach(r => {
    const from = findNodeById(r.from_id);
    const to = findNodeById(r.to_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${from ? escapeHtml(from.name) : '<span class="badge warn-mismatch">不明</span>'}</td>
      <td>${to ? escapeHtml(to.name) : '<span class="badge warn-mismatch">不明</span>'}</td>
      <td><span class="badge">${escapeHtml(r.type)}</span></td>
      <td title="${escapeHtml(r.note || '')}">${escapeHtml(truncate(r.note, 20) || '-')}</td>
      <td><span class="badge">${escapeHtml(r.source)}</span></td>
      <td>${confidenceBadge(r)}</td>
    `;
    const tdActions = document.createElement('td');
    tdActions.className = 'row-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openEditModal('relation', r.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.className = 'delete';
    delBtn.addEventListener('click', () => { if (deleteRelation(r.id)) { saveToStorage(); renderAll(); } });
    tdActions.appendChild(editBtn);
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  if (!filtered.length && data.relations.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">該当する関係がありません</td></tr>';
  }
  setEmptyState('relations', data.relations.length === 0);
}

function updateStats() {
  document.getElementById('statOwners').textContent = data.owners.length;
  document.getElementById('statShops').textContent = data.shops.length;
  document.getElementById('statRelations').textContent = data.relations.length;
}

function renderAll() {
  renderOwnersTable();
  renderShopsTable();
  renderRelationsTable();
  updateStats();
}

// ------------------------------------------------------------------
// JSON 読み込み・ダウンロード・書き出し
// ------------------------------------------------------------------
document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!Array.isArray(parsed.owners) || !Array.isArray(parsed.shops) || !Array.isArray(parsed.relations)) {
        throw new Error('owners / shops / relations 形式のJSON（manager.pyの生データ形式）を指定してください');
      }
      data = parsed;
      saveToStorage();
      renderAll();
    } catch (err) {
      alert('読み込みに失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  data.metadata.updated_at = new Date().toISOString();
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'network.json');
});

document.getElementById('exportVisualizerBtn').addEventListener('click', () => {
  const nodes = [];
  data.owners.forEach(o => nodes.push({
    id: o.id, label: o.name, node_type: 'owner', area: o.area, group: o.group || '', confidence: o.confidence,
  }));
  data.shops.forEach(s => nodes.push({
    id: s.id, label: s.name, node_type: 'shop', genre: s.genre || '', area: s.area, group: s.group || '', confidence: s.confidence,
  }));
  const edges = [];
  data.shops.forEach(s => edges.push({ from_id: s.owner_id, to_id: s.id, type: 'owner_shop', confidence: s.confidence }));
  data.relations.forEach(r => edges.push({ from_id: r.from_id, to_id: r.to_id, type: r.type, confidence: r.confidence }));
  const payload = { metadata: data.metadata, nodes, edges };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'network_for_visualizer.json');
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('すべてのデータを消去します。よろしいですか？')) return;
  data = initData();
  saveToStorage();
  renderAll();
});

document.getElementById('sampleBtn').addEventListener('click', () => {
  if (data.owners.length || data.shops.length || data.relations.length) {
    if (!confirm('現在のデータを上書きしてサンプルを読み込みます。よろしいですか？')) return;
  }
  data = buildSampleData();
  saveToStorage();
  renderAll();
});

function buildSampleData() {
  return {
    metadata: { updated_at: new Date().toISOString(), area: 'Chiba', version: '1.0' },
    owners: [
      { id: 'owner_86575258', name: '山田太郎', area: '市川', group: '山田商事', note: '市川駅前プラザ', source: 'manual', confidence: 'sure' },
      { id: 'owner_28633986', name: '鈴木花子', area: '市川', group: '山田商事', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_cc517fe7', name: '田中一郎', area: '船橋', group: '田中フーズ', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_42f49f08', name: '佐藤次郎', area: '船橋', group: '田中フーズ', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_5b5b1012', name: '高橋三郎', area: '浦安', group: '高橋グループ', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_dc9cc531', name: '伊藤四郎', area: '浦安', group: '', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_b4623637', name: '渡辺五郎', area: '松戸', group: '渡辺商店', note: '', source: 'manual', confidence: 'sure' },
      { id: 'owner_7a210029', name: '中村六郎', area: '松戸', group: '', note: '', source: 'manual', confidence: 'sure' },
    ],
    shops: [
      { id: 'shop_41f1b9eb', name: 'ラーメンABC', genre: 'ラーメン', owner_id: 'owner_86575258', area: '市川', group: '山田商事', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_fd90925e', name: '焼肉やまだ', genre: '焼肉', owner_id: 'owner_86575258', area: '市川', group: '山田商事', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_0955d66f', name: 'カフェすずき', genre: 'カフェ', owner_id: 'owner_28633986', area: '市川', group: '山田商事', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_869f5674', name: '居酒屋たなか', genre: '居酒屋', owner_id: 'owner_cc517fe7', area: '船橋', group: '田中フーズ', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_75fa4a6f', name: '寿司たなか', genre: '寿司', owner_id: 'owner_cc517fe7', area: '船橋', group: '田中フーズ', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_068832d1', name: 'イタリアン佐藤', genre: 'イタリアン', owner_id: 'owner_42f49f08', area: '船橋', group: '田中フーズ', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_4685945c', name: '焼鳥たかはし', genre: '焼鳥', owner_id: 'owner_5b5b1012', area: '浦安', group: '高橋グループ', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_feaa6358', name: 'ラーメン伊藤', genre: 'ラーメン', owner_id: 'owner_dc9cc531', area: '浦安', group: '', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_6c53b7c5', name: '定食わたなべ', genre: '定食', owner_id: 'owner_b4623637', area: '松戸', group: '渡辺商店', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
      { id: 'shop_e965d7c3', name: '喫茶なかむら', genre: '喫茶', owner_id: 'owner_7a210029', area: '松戸', group: '', address: '', tabelog_url: '', source: 'manual', confidence: 'sure' },
    ],
    relations: [
      { id: 'rel_a1067f9a', from_id: 'owner_86575258', to_id: 'owner_28633986', type: 'family', note: '姉弟', source: 'manual', confidence: 'sure' },
      { id: 'rel_c3ee2668', from_id: 'owner_cc517fe7', to_id: 'owner_42f49f08', type: 'business', note: '共同経営', source: 'manual', confidence: 'sure' },
      { id: 'rel_3e6c513d', from_id: 'owner_86575258', to_id: 'owner_cc517fe7', type: 'same_building', note: '市川駅前プラザで面識', source: 'manual', confidence: 'sure' },
      { id: 'rel_3199ae4f', from_id: 'owner_5b5b1012', to_id: 'owner_dc9cc531', type: 'other', note: '商工会つながり', source: 'manual', confidence: 'medium' },
    ],
  };
}

renderAll();
