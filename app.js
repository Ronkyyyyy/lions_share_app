/* 『近似値の金獅子』問題表示アプリ */
'use strict';

(() => {
  const CONFIG = {
    APP_VERSION: '0.3.0',
    DATA_URL: 'data/questions.json',
    RULEBOOK_URL: '',          // 公開先が決まったら URL を入れる（空なら「準備中」と表示）
    ROUNDS: 5,
    REVEAL_THRESHOLD: 0.3,     // 檻の高さの30%を超えて離すと開示
    BORDER_DELAY: 650,         // 確定からボーダー早見表を出すまで（ms）
  };
  const STORE_KEY = 'kinjishi.v1';

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

  /* ───── 問題データとセット ───── */
  let data = null;
  const byId = new Map();

  async function loadData() {
    const res = await fetch(CONFIG.DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
    byId.clear();
    data.questions.forEach((q) => byId.set(q.id, q));
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
  function buildSets() {
    const makePools = (key) => {
      const pools = {};
      data.questions.forEach((q) => { (pools[q[key]] = pools[q[key]] || []).push(q.id); });
      Object.values(pools).forEach(shuffle);
      return pools;
    };
    const byGrade = data.rounds.some((r) => r.grades);
    const key = byGrade ? 'grade' : 'type';
    const keyName = byGrade ? '段階' : '型';
    const pools = makePools(key);
    const columns = data.rounds.map((round) => {
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
    const count = Math.min(...columns.map((c) => c.length));
    if (columns.some((c) => c.length !== count)) console.warn('枠ごとの問題数がそろっていません');
    const sets = [];
    for (let s = 0; s < count; s++) sets.push(columns.map((c) => c[s]));
    store.sets = sets;
    store.played = [];
    store.dataVersion = data.version;
    saveStore();
  }

  function ensureSets() {
    const ok = store.dataVersion === data.version &&
      Array.isArray(store.sets) && store.sets.length > 0 &&
      store.sets.every((s) => s.length === CONFIG.ROUNDS && s.every((id) => byId.has(id)));
    if (!ok) buildSets();
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

  function openRulebook() {
    if (CONFIG.RULEBOOK_URL) window.open(CONFIG.RULEBOOK_URL, '_blank', 'noopener');
    else toast('ルールブックは準備中です');
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
    const played = store.played || [];
    setsGrid.innerHTML = store.sets.map((_, i) => `
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

  /* ───── ゲーム ───── */
  const el = {
    frame: $('#frame'),
    cage: $('#cage'),
    plate: $('#plate'),
    plateInner: $('#plate .plate-inner'),
    plateQ: $('#plate-q'),
    plateAsof: $('#plate-asof'),
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
    const q = byId.get(store.sets[G.set][G.round]);
    G.q = q;
    G.phase = 'idle';
    G.viaKeyboard = false;
    G.slots = null;

    el.roundSet.textContent = `セット${G.set + 1}`;
    el.roundCur.textContent = G.round + 1;
    el.roundTotal.textContent = CONFIG.ROUNDS;

    // 問題（開示前は正解に関わる情報を DOM に置かない）
    const asOf = formatAsOf(q.asOf);
    el.plateQ.textContent = q.question;
    el.plateAsof.textContent = asOf;
    el.plateSource.textContent = q.source || '';
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
    store.played = store.played || [];
    store.played[G.set] = true;
    saveStore();
    $('#end-set').textContent = `セット${G.set + 1}`;
    show('end');
  }

  function leaveGame() {
    cancelAll();
    G.phase = 'idle';
    show('title');
  }

  /* ───── 操作の振り分け ───── */
  const actions = {
    start() { renderSets(); show('sets'); },
    title() { if (current === 'game') leaveGame(); else show('title'); },
    rulebook: openRulebook,
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
      if (await ask('問題セットを組み直しますか？\nプレイ済みの記録も消えます。', '組み直す')) {
        buildSets();
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
    $('#settings-meta').innerHTML =
      `問題データ ${escapeHtml(data.version)}（${data.questions.length}問・${store.sets.length}セット）<br>アプリ v${CONFIG.APP_VERSION}`;
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
    try {
      await loadData();
    } catch (err) {
      console.error(err);
      show('title');
      toast('問題データを読み込めませんでした');
      $('[data-action="start"]').disabled = true;
      return;
    }
    ensureSets();
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
