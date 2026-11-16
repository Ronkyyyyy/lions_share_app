/* 『近似値の金獅子』問題表示アプリ */
'use strict';

(() => {
  const CONFIG = {
    APP_VERSION: '0.4.0',
    DEMO_URL: 'data/demo-pack.json', // アプリに同梱する体験パック（購入パックは .lish で読み込む）
    RULEBOOK_URL: '',          // 外部サイトで開きたいときだけ URL を入れる（空ならアプリ内で表示）
    RULEBOOK_MD: 'rulebook.md', // アプリ内で表示するルールブック（差し替えるだけで更新される）
    ROUNDS: 5,
    REVEAL_THRESHOLD: 0.3,     // 檻の高さの30%を超えて離すと開示
    BORDER_DELAY: 650,         // 確定からボーダー早見表を出すまで（ms）
  };
  const STORE_KEY = 'kinjishi.v1';
  window.KINJISHI_APP_VERSION = CONFIG.APP_VERSION; // index.html 側で版ずれを検知するため

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tm = () => (reduceMotion.matches ? 0.35 : 1); // 移動演出の時間倍率
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
  const fmt = (n) => n.toLocaleString('en-US');
  // 桁区切りのカンマ：問題データで "comma": false のとき、または単位が「年」（西暦）のときは付けない
  const useComma = (q) => q.comma !== false && q.unit !== '年';
  const fmtFor = (n, q) => (useComma(q) ? fmt(n) : String(n));

  /* ───── 保存 ───── */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  }
  const store = loadStore();

  /* ───── 獅子アイコン ───── */
  function mountLions(root = document) {
    const tpl = $('#tpl-lion');
    $$('.lion:not(.is-mounted)', root).forEach((el) => {
      el.appendChild(tpl.content.cloneNode(true));
      el.classList.add('is-mounted');
    });
  }

  /* ───── 問題パック ───── */
  // 体験パック（アプリに同梱）と、購入者が読み込んだパック（.lish）を扱う。
  // 読み込んだパックはこの端末のブラウザに保存する
  const PACKS_KEY = 'kinjishi.packs.v1';
  let builtinPack = null;          // 体験パック
  let data = null;                 // いま遊んでいるパック
  const byId = new Map();          // いま遊んでいるパックの問題（ID → 問題）

  function loadImported() {
    try { return JSON.parse(localStorage.getItem(PACKS_KEY)) || {}; } catch (_) { return {}; }
  }
  let imported = loadImported();
  function saveImported() { localStorage.setItem(PACKS_KEY, JSON.stringify(imported)); } // 容量不足のときは例外を投げる

  async function loadBuiltin() {
    const res = await fetch(CONFIG.DEMO_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    builtinPack = await res.json();
  }

  function allPacks() {
    const list = builtinPack ? [builtinPack] : [];
    return list.concat(Object.values(imported).sort((a, b) => String(a.pack).localeCompare(String(b.pack))));
  }
  function findPack(id) {
    if (builtinPack && builtinPack.pack === id) return builtinPack;
    return imported[id] || null;
  }
  const isBuiltin = (p) => p === builtinPack;

  // パックごとの記録（組んだセット・プレイ済み・データの版）
  function packState(p = data) {
    store.packs = store.packs || {};
    return (store.packs[p.pack] = store.packs[p.pack] || {});
  }

  function selectPack(p) {
    data = p;
    byId.clear();
    data.questions.forEach((q) => byId.set(q.id, q));
    ensureSets(p);
  }

  /* ───── .lish（問題パックのファイル）の読み込み ─────
     中身は「LISH1 <検査値>」の1行目と、ネタバレ防止のために変換した本文。
     暗号ではなく、ファイルをうっかり開いても正解が読めないようにするためのもの */
  const LISH_KEY = new TextEncoder().encode("lion's share");
  const lishMask = (i) => LISH_KEY[i % LISH_KEY.length] ^ ((i * 131 + 7) & 0xff);
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function fail(message) { const e = new Error(message); e.user = true; throw e; }

  function decodeLish(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const m = /^LISH1 ([0-9a-f]{8})$/.exec((lines[0] || '').trim());
    if (!m) fail('『近似値の金獅子』のパック（.lish）ではないようです');
    let bin;
    try { bin = atob(lines.slice(1).join('').replace(/\s/g, '')); } catch (_) { fail('パックのファイルが壊れています'); }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ lishMask(i);
    if (fnv1a(bytes) !== m[1]) fail('パックのファイルが壊れています');
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { fail('パックのファイルが壊れています'); }
  }

  function validatePack(p) {
    if (!p || typeof p.pack !== 'string' || !p.pack) fail('パックIDがありません');
    if (!Array.isArray(p.questions) || !p.questions.length) fail('問題が入っていません');
    if (!Array.isArray(p.rounds) || p.rounds.length !== CONFIG.ROUNDS) fail('ラウンドの設定が正しくありません');
    const ids = new Set();
    p.questions.forEach((q) => {
      if (!q || typeof q.id !== 'string' || typeof q.question !== 'string' ||
          !Number.isSafeInteger(q.answer) || q.answer < 0) fail('問題データに不備があります');
      if (ids.has(q.id)) fail('問題IDが重複しています');
      ids.add(q.id);
    });
    if (!buildSets(p, false).length) fail('問題セットを組めませんでした');
  }

  const importInput = document.createElement('input');
  importInput.type = 'file'; // accept は付けない（iPhone で独自の拡張子が選べなくなるため）
  importInput.hidden = true;
  document.body.appendChild(importInput);
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      const p = decodeLish(await file.text());
      validatePack(p);
      if (builtinPack && builtinPack.pack === p.pack) fail('体験パックと同じIDのパックは読み込めません');
      const old = imported[p.pack];
      const label = packLabelOf(p);
      if (old && old.version === p.version) { toast(`${label}［${p.pack}］は読み込み済みです`); return; }
      if (old && !(await ask(`${label}［${p.pack}］はすでに読み込まれています。\n新しい版に置き換えますか？\nこのパックのプレイ済みの記録は消えます。`, '置き換える'))) return;
      imported[p.pack] = p;
      try { saveImported(); } catch (_) {
        if (old) imported[p.pack] = old; else delete imported[p.pack];
        fail('端末の保存領域が足りないため、読み込めませんでした');
      }
      ensureSets(p);
      renderPacks();
      if (current === 'settings') renderSettingsMeta();
      toast(`${label}［${p.pack}］を読み込みました`);
    } catch (err) {
      console.warn(err);
      toast(err.user ? err.message : 'パックを読み込めませんでした');
    }
  });

  async function deletePack(id) {
    const p = imported[id];
    if (!p) return;
    if (!(await ask(`${packLabelOf(p)}［${id}］をこの端末から削除しますか？\nプレイ済みの記録も消えます。\nもう一度遊ぶときは、パックのファイルを読み込み直してください。`, '削除する'))) return;
    delete imported[id];
    try { saveImported(); } catch (_) {}
    if (store.packs) delete store.packs[id];
    saveStore();
    renderPacks();
    toast('パックを削除しました');
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ラウンドごとの枠（rounds）に沿って、ランダムに5問セットへ配分する。
  // rounds[i].grades（心理／クイズの段階）または rounds[i].types（型）に
  // 「全セット合計で、その枠に何問ずつ入れるか」を書く。grades があればそちらを優先
  // p：対象のパック／save：false なら記録せずに組んだ結果だけ返す（読み込み時の確認用）
  function buildSets(p = data, save = true) {
    const makePools = (key) => {
      const pools = {};
      p.questions.forEach((q) => { (pools[q[key]] = pools[q[key]] || []).push(q.id); });
      Object.values(pools).forEach(shuffle);
      return pools;
    };
    const byGrade = p.rounds.some((r) => r.grades);
    const key = byGrade ? 'grade' : 'type';
    const keyName = byGrade ? '段階' : '型';
    const pools = makePools(key);
    const columns = p.rounds.map((round) => {
      const col = [];
      Object.entries(round[byGrade ? 'grades' : 'types'] || {}).forEach(([k, n]) => {
        for (let i = 0; i < n; i++) {
          const id = (pools[k] || []).pop();
          if (id) col.push(id);
          else console.warn(`枠「${round.label}」：${keyName}「${k}」の問題が足りません`);
        }
      });
      return shuffle(col);
    });
    Object.entries(pools).forEach(([k, rest]) => {
      if (rest.length) console.warn(`${keyName}「${k}」の問題が ${rest.length} 問余っています（枠の内訳と数が一致していません）`);
    });
    const count = columns.length ? Math.min(...columns.map((c) => c.length)) : 0;
    if (columns.some((c) => c.length !== count)) console.warn('枠ごとの問題数がそろっていません');
    const sets = [];
    for (let s = 0; s < count; s++) sets.push(columns.map((c) => c[s]));
    if (save) {
      const st = packState(p);
      st.sets = sets;
      st.played = [];
      st.dataVersion = p.version;
      saveStore();
    }
    return sets;
  }

  function ensureSets(p = data) {
    const st = packState(p);
    const ids = new Set(p.questions.map((q) => q.id));
    const ok = st.dataVersion === p.version &&
      Array.isArray(st.sets) && st.sets.length > 0 &&
      st.sets.every((s) => s.length === CONFIG.ROUNDS && s.every((id) => ids.has(id)));
    if (!ok) buildSets(p);
  }

  function formatAsOf(asOf) {
    if (!asOf) return '';
    const m = /^(\d{4})-(\d{1,2})/.exec(asOf);
    return m ? `${m[1]}年${Number(m[2])}月時点` : `${asOf}時点`;
  }

  /* ───── 画面 ───── */
  let current = '';
  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
    current = name;
  }

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-shown'), 2400);
  }

  const modal = $('#modal');
  function ask(text, okLabel = 'OK') {
    if (typeof modal.showModal !== 'function') return Promise.resolve(window.confirm(text));
    $('#modal-text').textContent = text;
    $('#modal-ok').textContent = okLabel;
    modal.returnValue = '';
    modal.showModal();
    return new Promise((resolve) => {
      modal.addEventListener('close', () => resolve(modal.returnValue === 'ok'), { once: true });
    });
  }

  /* ───── ルールブック（rulebook.md をアプリ内で表示） ───── */
  let rbReturn = 'title';
  let rbLoaded = false;

  async function openRulebook() {
    if (CONFIG.RULEBOOK_URL) { window.open(CONFIG.RULEBOOK_URL, '_blank', 'noopener'); return; }
    rbReturn = current && current !== 'rulebook' ? current : 'title';
    show('rulebook');
    el.rbBody.scrollTop = 0;
    if (rbLoaded) return;
    el.rbPage.innerHTML = '<p class="rb-status">読み込み中…</p>';
    try {
      const res = await fetch(CONFIG.RULEBOOK_MD, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      el.rbPage.innerHTML = mdToHtml(await res.text());
      rbLoaded = true;
    } catch (err) {
      el.rbPage.innerHTML = '<p class="rb-status">ルールブックを読み込めませんでした。<br>一度オンラインで開くと、次からはオフラインでも読めます。</p>';
    }
  }

  // ルールブック用の軽い Markdown 変換。
  // 対応：見出し（#〜####）、段落、箇条書き（- / 1.、字下げで入れ子）、**太字**、_斜体_、`コード`、区切り線（---）
  // Obsidian のリンク [[名前]] は文字だけ残す
  function mdToHtml(md) {
    const inline = (t) => escapeHtml(t)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    const out = [];
    const lists = []; // { type: 'ul' | 'ol', indent }
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(''))}</p>`); para = []; } };
    const closeList = () => { const l = lists.pop(); out.push(`</li></${l.type}>`); };
    const closeLists = (indent) => { while (lists.length && lists[lists.length - 1].indent > indent) closeList(); };

    md.replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
      const line = raw.replace(/\t/g, '    ');
      if (!line.trim()) { flushPara(); closeLists(-1); return; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara(); closeLists(-1);
        const lv = m[1].length + 1;
        out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
        return;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeLists(-1); out.push('<hr>'); return; }
      if ((m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line))) {
        flushPara();
        const indent = m[1].length;
        const type = /\d/.test(m[2]) ? 'ol' : 'ul';
        closeLists(indent);
        const top = lists[lists.length - 1];
        if (top && top.indent === indent && top.type !== type) closeList();
        const now = lists[lists.length - 1];
        if (now && now.indent === indent) out.push(`</li><li>${inline(m[3])}`);
        else { lists.push({ type, indent }); out.push(`<${type}><li>${inline(m[3])}`); }
        return;
      }
      if (lists.length) { out.push(inline(' ' + line.trim())); return; } // 箇条書きの続きの行
      para.push(line.trim());
    });
    flushPara(); closeLists(-1);
    return out.join('');
  }

  /* ───── チュートリアル ───── */
  let tutPage = 0;
  let tutReturn = 'title';
  const tutPages = $$('.tut-page');
  const tutDots = $$('.tut-dots i');

  function openTutorial(ret) {
    tutReturn = ret;
    tutPage = 0;
    renderTutorial();
    show('tutorial');
  }
  function renderTutorial() {
    tutPages.forEach((p, i) => {
      p.classList.toggle('is-active', i === tutPage);
      p.classList.toggle('is-past', i < tutPage);
    });
    tutDots.forEach((d, i) => d.classList.toggle('is-on', i === tutPage));
    $('[data-action="tut-next"]').textContent = tutPage === tutPages.length - 1 ? 'はじめる' : '次へ';
  }
  function finishTutorial() {
    store.tutorialDone = true;
    saveStore();
    show(tutReturn);
  }

  /* ───── セット選択 ───── */
  const setsGrid = $('#sets-grid');
  function renderSets() {
    const st = packState();
    const played = st.played || [];
    renderPackBadge();
    setsGrid.innerHTML = st.sets.map((_, i) => `
      <button class="set-btn${played[i] ? ' is-played' : ''}" data-set="${i}">
        <span class="lion" data-lion="${played[i] ? 'bronze' : 'gold'}"></span>
        <span class="set-name">セット <span class="set-no">${i + 1}</span></span>
        <span class="set-state">${played[i] ? 'プレイ済み' : '未プレイ'}</span>
      </button>`).join('');
    mountLions(setsGrid);
  }
  setsGrid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]');
    if (b) startGame(Number(b.dataset.set));
  });

  /* ───── パック選択 ───── */
  const packList = $('#pack-list');
  function renderPacks() {
    const packs = allPacks();
    packList.innerHTML = packs.map((p) => {
      ensureSets(p);
      const st = packState(p);
      const total = st.sets.length;
      const done = (st.played || []).filter(Boolean).length;
      const label = escapeHtml(packLabelOf(p));
      const id = escapeHtml(p.pack);
      return `
      <li class="pack-card${isBuiltin(p) ? ' is-builtin' : ''}">
        <button class="pack-main" data-pack="${id}">
          <span class="lion" data-lion="${isBuiltin(p) ? 'silver' : 'gold'}"></span>
          <span class="pack-text">
            <span class="pack-title">${label}<span class="pack-card-id">${id}</span></span>
            <span class="pack-sub">${p.questions.length}問・${total}セット・プレイ済み ${done}／${total}</span>
          </span>
        </button>
        ${isBuiltin(p) ? '' : `<button class="pack-del" data-del="${id}" aria-label="${label}を削除">削除</button>`}
      </li>`;
    }).join('') || '<li class="pack-empty">遊べるパックがありません。パックを読み込んでください。</li>';
    mountLions(packList);
  }
  packList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { deletePack(del.dataset.del); return; }
    const b = e.target.closest('[data-pack]');
    if (!b) return;
    const p = findPack(b.dataset.pack);
    if (!p) return;
    selectPack(p);
    renderSets();
    show('sets');
  });

  /* ───── ゲーム ───── */
  const el = {
    frame: $('#frame'),
    cage: $('#cage'),
    plate: $('#plate'),
    plateInner: $('#plate .plate-inner'),
    plateQ: $('#plate-q'),
    plateAsof: $('#plate-asof'),
    rbBody: $('#rulebook-body'),
    rbPage: $('#rulebook-page'),
    plateSource: $('#plate-source'),
    knob: $('#knob'),
    hint: $('#knob-hint'),
    answer: $('#answer'),
    answerQ: $('#answer-q'),
    answerQText: $('#answer-q-text'),
    answerAsof: $('#answer-asof'),
    num: $('#answer-num'),
    note: $('#answer-note'),
    shine: $('#shine'),
    borders: $('#borders'),
    rangeSilver: $('#range-silver'),
    rangeBronze: $('#range-bronze'),
    next: $('#btn-next'),
    retry: $('#btn-retry'),
    roundSet: $('#round-set'),
    roundCur: $('#round-cur'),
    roundTotal: $('#round-total'),
  };

  const G = {
    set: -1,
    round: 0,
    q: null,
    phase: 'idle',   // idle | dragging | revealing | counting | done
    lift: 0,
    timers: [],
    raf: 0,
    viaKeyboard: false,
    slots: null,
  };
  let hintDone = false; // 一度操作したら揺れと案内を止める

  function later(fn, ms) { G.timers.push(setTimeout(fn, ms)); }

  function cancelAll() {
    G.timers.forEach(clearTimeout);
    G.timers = [];
    cancelAnimationFrame(G.raf);
    [el.cage, el.answerQ].forEach((node) => node.getAnimations().forEach((a) => a.cancel()));
    drag = null;
  }

  function startGame(setIndex) {
    G.set = setIndex;
    G.round = 0;
    show('game');
    loadRound();
  }

  function loadRound() {
    cancelAll();
    const q = byId.get(packState().sets[G.set][G.round]);
    G.q = q;
    G.phase = 'idle';
    G.viaKeyboard = false;
    G.slots = null;

    el.roundSet.textContent = `${packLabel()}・セット${G.set + 1}`;
    el.roundCur.textContent = G.round + 1;
    el.roundTotal.textContent = CONFIG.ROUNDS;

    // 問題（開示前は正解に関わる情報を DOM に置かない）
    const asOf = formatAsOf(q.asOf);
    el.plateQ.textContent = q.question;
    el.plateAsof.textContent = asOf;
    if (el.plateSource) el.plateSource.textContent = q.source || ''; // 古い index.html でも止まらないように
    el.plate.classList.toggle('has-source', !!q.source);
    el.answerQText.textContent = q.question;
    el.answerAsof.textContent = asOf;
    el.plateInner.style.visibility = '';
    el.answerQ.style.visibility = 'hidden';
    el.num.innerHTML = '';
    el.num.style.fontSize = '';
    el.note.textContent = '';
    el.rangeSilver.textContent = '';
    el.rangeBronze.textContent = '';

    el.answer.classList.remove('is-confirmed');
    el.shine.classList.remove('is-run');
    el.cage.classList.remove('is-gone');
    setCage(0);
    el.borders.classList.remove('is-shown');
    el.next.classList.remove('is-shown');
    el.next.textContent = G.round === CONFIG.ROUNDS - 1 ? '結果へ →' : '次の問題 →';
    el.retry.disabled = true;

    el.knob.classList.toggle('is-wobble', !hintDone);
    el.hint.classList.toggle('is-hidden', hintDone);

    requestAnimationFrame(fitPlate);
  }

  // 問題文をプレートに収まる最大サイズにする
  function fitPlate() {
    const box = el.plateInner;
    const h = box.clientHeight;
    const w = box.clientWidth;
    if (!h || !w) return;
    let lo = 14;
    let hi = Math.max(lo, Math.min(h * 0.4, w * 0.11, 84));
    const fits = (size) => {
      box.style.fontSize = size + 'px';
      return box.scrollHeight <= h + 1 && el.plateQ.scrollWidth <= el.plateQ.clientWidth + 1;
    };
    if (fits(hi)) return;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    box.style.fontSize = lo + 'px';
  }

  function setCage(lift) {
    G.lift = lift;
    el.cage.style.transform = lift ? `translateY(${-lift}px)` : '';
  }
  function currentLift() {
    const t = getComputedStyle(el.cage).transform;
    if (!t || t === 'none') return 0;
    return Math.max(0, -new DOMMatrixReadOnly(t).m42);
  }

  function stopHint() {
    if (hintDone) return;
    hintDone = true;
    el.knob.classList.remove('is-wobble');
    el.hint.classList.add('is-hidden');
  }

  /* 金獅子のドラッグ（スワイプの起点は金獅子に限る） */
  let drag = null;

  el.knob.addEventListener('pointerdown', (e) => {
    if (G.phase !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    stopHint();
    const lift = currentLift();
    el.cage.getAnimations().forEach((a) => a.cancel());
    setCage(lift);
    try { el.knob.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { id: e.pointerId, y0: e.clientY, base: lift, t0: performance.now(), moved: 0, h: el.frame.clientHeight };
    G.phase = 'dragging';
  });

  el.knob.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y0 - e.clientY;
    drag.moved = Math.max(drag.moved, Math.abs(dy));
    setCage(Math.min(drag.h, Math.max(0, drag.base + dy)));
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    G.phase = 'idle';
    if (e.type !== 'pointercancel' && G.lift >= d.h * CONFIG.REVEAL_THRESHOLD) {
      reveal(G.lift);
    } else if (d.moved < 8 && performance.now() - d.t0 < 400 && d.base < 2) {
      tapHint();
    } else {
      dropBack(G.lift);
    }
  }
  el.knob.addEventListener('pointerup', endDrag);
  el.knob.addEventListener('pointercancel', endDrag);
  el.knob.addEventListener('lostpointercapture', (e) => { if (drag) endDrag(e); });
  el.knob.addEventListener('contextmenu', (e) => e.preventDefault());

  // キーボード：Enter / Space で開示
  el.knob.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && G.phase === 'idle') {
      e.preventDefault();
      stopHint();
      G.viaKeyboard = true;
      reveal(currentLift());
    }
  });
  el.knob.addEventListener('click', (e) => e.preventDefault());

  // 届かなかったとき：重みのある動きで元に戻る
  function dropBack(lift) {
    if (lift < 1) { setCage(0); return; }
    const bounce = Math.min(12, lift * 0.06);
    setCage(0);
    el.cage.animate([
      { transform: `translateY(${-lift}px)`, easing: 'cubic-bezier(.55, 0, .9, .45)' },
      { transform: 'translateY(0)', offset: 0.7, easing: 'cubic-bezier(.2, .7, .4, 1)' },
      { transform: `translateY(${-bounce}px)`, offset: 0.85, easing: 'cubic-bezier(.6, 0, .9, .5)' },
      { transform: 'translateY(0)' },
    ], { duration: (360 + lift * 0.5) * tm() });
  }

  // タップだけのとき：檻が少し浮いて戻り、引けることを示す
  function tapHint() {
    const up = el.frame.clientHeight * 0.08;
    el.cage.animate([
      { transform: 'translateY(0)', easing: 'cubic-bezier(.2, .7, .3, 1)' },
      { transform: `translateY(${-up}px)`, offset: 0.35, easing: 'cubic-bezier(.55, 0, .9, .45)' },
      { transform: 'translateY(0)', offset: 0.72, easing: 'cubic-bezier(.2, .7, .4, 1)' },
      { transform: `translateY(${-up * 0.15}px)`, offset: 0.86, easing: 'ease-in' },
      { transform: 'translateY(0)' },
    ], { duration: 720 * Math.max(tm(), 0.6) });
  }

  /* ───── 正解発表 ───── */
  function reveal(lift) {
    G.phase = 'revealing';
    el.retry.disabled = false;
    vibrate(25);

    const h = el.frame.clientHeight;

    // 問題文がプレートから離れ、縮小しながら正解欄の上部へ
    const first = el.plateQ.getBoundingClientRect();
    el.answerQ.style.visibility = 'visible';
    const last = el.answerQText.getBoundingClientRect();
    el.plateInner.style.visibility = 'hidden';
    const s = first.width / last.width;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    el.answerQ.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
      { transform: 'none' },
    ], { duration: 720 * tm(), delay: 80 * tm(), easing: 'cubic-bezier(.25, .8, .25, 1)', fill: 'backwards' });

    // 檻は上へ抜ける
    setCage(h + 40);
    el.cage.animate([
      { transform: `translateY(${-lift}px)` },
      { transform: `translateY(${-(h + 40)}px)` },
    ], { duration: Math.max(180, 480 * (1 - lift / h)) * tm(), easing: 'cubic-bezier(.4, .1, .7, .3)' })
      .finished.then(() => el.cage.classList.add('is-gone')).catch(() => {});

    later(startCount, 820 * tm());
  }

  // 最終的な桁数とカンマの位置を最初から確保する
  function buildNumber(answer, q) {
    const unit = q.unit;
    const str = fmtFor(answer, q);
    const slots = [];
    let html = '';
    let lastDigit = -1;
    for (const ch of str) {
      if (ch === ',') {
        html += `<span class="c off" data-after="${lastDigit}">,</span>`;
      } else {
        lastDigit = slots.length;
        slots.push(null);
        html += '<span class="d off">0</span>'; // 幅と高さを確保するため非表示の0を置く
      }
    }
    html += `<span class="u">${escapeHtml(unit || '')}</span>`;
    el.num.innerHTML = html;
    const digitEls = $$('.d', el.num);
    const commaEls = $$('.c', el.num).map((c) => ({ el: c, after: Number(c.dataset.after) }));
    G.slots = { digits: digitEls, commas: commaEls, shown: digitEls.map(() => '') };
    fitNumber();
  }

  function renderValue(v) {
    const { digits, commas, shown } = G.slots;
    const s = String(v);
    const n = digits.length;
    const start = n - s.length;
    for (let i = 0; i < n; i++) {
      const ch = i >= start ? s[i - start] : '';
      if (ch !== shown[i]) {
        shown[i] = ch;
        digits[i].textContent = ch || '0';
        digits[i].classList.toggle('off', !ch);
      }
    }
    commas.forEach((c) => c.el.classList.toggle('off', c.after < start));
  }

  // 正解の数字を正解欄の幅に収まる最大サイズにする
  function fitNumber() {
    if (!G.slots) return;
    const main = el.num.parentElement;
    const availW = main.clientWidth * 0.94;
    const availH = main.clientHeight * 0.92;
    el.num.style.fontSize = '100px';
    const r = el.num.getBoundingClientRect();
    const size = Math.min(100 * availW / r.width, 100 * availH / r.height, 420);
    el.num.style.fontSize = Math.max(16, size) + 'px';
  }

  // 演出時間は「2秒＋1桁ごとに0.5秒」、上限6秒。終盤ほど減速
  function countDuration(answer) {
    return Math.min(6, 2 + 0.5 * String(answer).length) * 1000;
  }
  const easeCount = (t) => 1 - Math.pow(1 - t, 3.2);

  function startCount() {
    G.phase = 'counting';
    const a = G.q.answer;
    buildNumber(a, G.q);
    renderValue(0);
    const D = countDuration(a);
    const t0 = performance.now();
    const step = (now) => {
      if (G.phase !== 'counting') return; // もう一度・中断で止めた後の描画は捨てる
      const t = Math.min(1, (now - t0) / D);
      if (t >= 1) { confirmAnswer(); return; }
      renderValue(Math.floor(a * easeCount(t)));
      G.raf = requestAnimationFrame(step);
    };
    G.raf = requestAnimationFrame(step);
  }

  function confirmAnswer() {
    G.phase = 'done';
    const a = G.q.answer;
    renderValue(a);
    vibrate([30, 50, 70]);
    el.answer.classList.add('is-confirmed');
    if (!reduceMotion.matches) el.shine.classList.add('is-run');
    el.note.textContent = G.q.note || '';

    // ボーダー（10%・25% を切り捨てて正解値から引いた値と足した値）
    const s10 = Math.floor(a / 10); // 正解×10% の切り捨て（小数の誤差が出ないよう整数で割る）
    const s25 = Math.floor(a / 4);  // 正解×25% の切り捨て
    el.rangeSilver.innerHTML = rangeHtml(a - s10, a + s10, G.q);
    el.rangeBronze.innerHTML = rangeHtml(a - s25, a + s25, G.q);

    later(() => {
      el.borders.classList.add('is-shown');
      el.next.classList.add('is-shown');
      if (G.viaKeyboard) el.next.focus();
    }, CONFIG.BORDER_DELAY);
  }

  function rangeHtml(lo, hi, q) {
    return `${fmtFor(lo, q)}<span class="tilde">〜</span>${fmtFor(hi, q)}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nextRound() {
    if (G.phase !== 'done') return;
    if (G.round < CONFIG.ROUNDS - 1) {
      G.round++;
      loadRound();
    } else {
      endGame();
    }
  }

  function endGame() {
    cancelAll();
    const st = packState();
    st.played = st.played || [];
    st.played[G.set] = true;
    saveStore();
    $('#end-set').textContent = `${packLabel()}・セット${G.set + 1}`;
    show('end');
  }

  function leaveGame() {
    cancelAll();
    G.phase = 'idle';
    show('title');
  }

  /* ───── 操作の振り分け ───── */
  const actions = {
    start() { renderPacks(); show('packs'); },
    sets() { renderSets(); show('sets'); },
    import() { importInput.click(); },
    title() { if (current === 'game') leaveGame(); else show('title'); },
    rulebook: openRulebook,
    'rulebook-back'() { show(rbReturn); },
    settings() { renderSettingsMeta(); show('settings'); },
    tutorial() { openTutorial('settings'); },
    'tut-next'() {
      if (tutPage < tutPages.length - 1) { tutPage++; renderTutorial(); } else finishTutorial();
    },
    'tut-skip': finishTutorial,
    async abort() {
      if (await ask('ゲームを中断して、タイトルに戻りますか？', '中断する')) leaveGame();
    },
    retry() { if (G.phase !== 'idle' && G.phase !== 'dragging') loadRound(); },
    next: nextRound,
    async reshuffle() {
      if (await ask('すべてのパックの問題セットを組み直しますか？\nプレイ済みの記録も消えます。', '組み直す')) {
        allPacks().forEach((p) => buildSets(p));
        renderSettingsMeta();
        toast('問題セットを組み直しました');
      }
    },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && actions[b.dataset.action]) actions[b.dataset.action](b);
  });

  function renderSettingsMeta() {
    const packs = allPacks().map((p) => `${escapeHtml(packLabelOf(p))}［${escapeHtml(p.pack)}］ ${escapeHtml(p.version || '')}`);
    $('#settings-meta').innerHTML =
      `遊べるパック<br>${packs.join('<br>') || 'なし'}<br>アプリ v${CONFIG.APP_VERSION}`;
  }

  /* ───── 問題パックの表示 ───── */
  // パックの packName（例：基本パック）と pack（例：A00）を画面に出す
  const packLabelOf = (p) => (p && (p.packName || p.pack)) || '';
  const packLabel = () => packLabelOf(data);
  function renderPackBadge() {
    const badge = $('#pack-badge');
    if (!badge || !data) return;
    badge.innerHTML =
      `<span class="pack-name">${escapeHtml(packLabel())}</span>` +
      (data.pack ? `<span class="pack-id">${escapeHtml(data.pack)}</span>` : '');
  }

  /* ───── 画面サイズの変化 ───── */
  // ボーダーが2行に折り返して正解欄が縮んだときなども、数字を収め直す
  if ('ResizeObserver' in window) new ResizeObserver(() => fitNumber()).observe(el.num.parentElement);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (current !== 'game') return;
      fitPlate();
      fitNumber();
      if (G.phase === 'idle') setCage(0);
      if (G.phase !== 'idle' && G.phase !== 'dragging' && el.cage.classList.contains('is-gone')) {
        setCage(el.frame.clientHeight + 40);
      }
    }, 120);
  });

  /* ───── 画面の常時点灯（Wake Lock） ───── */
  let wakeLock = null;
  async function requestWakeLock() {
    if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { wakeLock = null; }
  }
  document.addEventListener('pointerdown', requestWakeLock, { passive: true });
  document.addEventListener('keydown', requestWakeLock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  /* ───── 起動 ───── */
  async function init() {
    mountLions();
    // 0.3 系までの記録（パックが1つだった頃の形）は使わない
    if (store.sets || store.played || store.dataVersion) {
      delete store.sets; delete store.played; delete store.dataVersion;
      saveStore();
    }
    try {
      await loadBuiltin();
    } catch (err) {
      console.error(err);
      if (!Object.keys(imported).length) toast('体験パックを読み込めませんでした');
    }
    if (!store.tutorialDone) openTutorial('title');
    else show('title');
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
    });
  }

  init();
})();
