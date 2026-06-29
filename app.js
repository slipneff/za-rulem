/* ============================================================
   app.js — роутер, рендер уроков и движок экзамена.
   ============================================================ */
(function () {
  'use strict';
  const CONTENT = window.CONTENT || { categories: [], topics: [] };
  const TDATA = window.TICKETS_DATA || { tickets: [], version: '', category: '' };
  const SIGNS = window.SIGNS || [];        // справочник знаков по разделам
  const signsCount = SIGNS.reduce((n, c) => n + c.signs.length, 0);

  /* -------------------------------------------------- Store (localStorage) */
  const KEY = 'driver_progress_v1';
  const Store = {
    data: null,
    load() {
      try { this.data = JSON.parse(localStorage.getItem(KEY)) || {}; }
      catch (e) { this.data = {}; }
      this.data.read ||= {}; this.data.q ||= {}; this.data.mistakes ||= {};
      this.data.ticketBest ||= {}; this.data.exams ||= []; this.data.blitzBest ||= 0;
      return this;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {} },
    markRead(id) { this.data.read[id] = true; this.save(); },
    isRead(id) { return !!this.data.read[id]; },
    answer(key, correct, snap) {
      const q = this.data.q[key] || { seen: 0, ok: 0 };
      q.seen++; if (correct) q.ok++; this.data.q[key] = q;
      if (correct) delete this.data.mistakes[key];
      else if (snap) this.data.mistakes[key] = snap;
      this.save();
    },
    mistakes() { return Object.values(this.data.mistakes); },
    addExam(score, total, pass) { this.data.exams.unshift({ d: Date.now(), score, total, pass }); this.data.exams = this.data.exams.slice(0, 30); this.save(); },
    setTicketBest(n, score) { if (!(n in this.data.ticketBest) || score > this.data.ticketBest[n]) { this.data.ticketBest[n] = score; this.save(); } },
    stats() {
      const qs = Object.values(this.data.q);
      const seen = qs.reduce((a, b) => a + b.seen, 0), ok = qs.reduce((a, b) => a + b.ok, 0);
      return {
        read: Object.keys(this.data.read).length,
        answered: qs.length, attempts: seen, ok,
        acc: seen ? Math.round(ok / seen * 100) : 0,
        mistakes: Object.keys(this.data.mistakes).length,
        examsPassed: this.data.exams.filter(e => e.pass).length,
      };
    },
  }.load();

  /* -------------------------------------------------- helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view'), nav = $('#nav'), crumb = $('#crumb'), topActions = $('#topActions');
  const app = $('#app');
  let cleanups = [];
  function clearView() { cleanups.forEach(fn => { try { fn(); } catch (e) {} }); cleanups = []; }
  const go = (h) => { location.hash = h; };
  const esc = s => (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]); };
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* -------------------------------------------------- offline precache bridge (page ↔ SW) */
  const hasSW = 'serviceWorker' in navigator;
  const swReady = hasSW ? navigator.serviceWorker.ready.catch(() => null) : Promise.resolve(null);
  function swSend(msg) { if (!hasSW) return; swReady.then(reg => { const sw = (reg && reg.active) || navigator.serviceWorker.controller; if (sw) sw.postMessage(msg); }); }
  let offlineUI = null;                    // колбэк, который рисует прогресс на странице статистики
  if (hasSW) navigator.serviceWorker.addEventListener('message', (e) => { if (offlineUI) offlineUI(e.data || {}); });

  /* -------------------------------------------------- question pool from tickets */
  const POOL = [];
  TDATA.tickets.forEach(t => t.questions.forEach((q, i) => POOL.push({
    ...q, key: `t${t.num}-${i}`, ticket: t.num, idx: i,
  })));
  const THEMES = [...new Set(POOL.map(q => q.theme).filter(Boolean))].sort();
  const themeSlug = t => t.replace(/\s+/g, '-').toLowerCase();
  const byThemeSlug = {}; THEMES.forEach(t => byThemeSlug[themeSlug(t)] = t);

  /* -------------------------------------------------- NAV */
  function renderNav() {
    const route = location.hash || '#/';
    const item = (h, ico, label, badge) =>
      `<a class="nav-item ${route === h || route.startsWith(h + '/') && h !== '#/' ? 'is-active' : ''}" href="${h}" data-link>
        <span class="nav-item__ico">${ico}</span><span>${label}</span>${badge ? `<span class="nav-item__badge">${badge}</span>` : ''}</a>`;
    let html = item('#/', '🏠', 'Главная');
    html += `<div class="nav-group"><div class="nav-group-title">Обучение</div>`;
    CONTENT.categories.forEach(c => { html += item('#/cat/' + c.id, c.icon, c.title, (CONTENT.topics.filter(t => t.cat === c.id).length) || ''); });
    if (signsCount) html += item('#/signs', '🚸', 'Все знаки', signsCount);
    html += `</div><div class="nav-group"><div class="nav-group-title">Экзамен ПДД 2026</div>`;
    html += item('#/exam', '📋', 'Билеты', '40');
    html += item('#/exam/sim', '🎯', 'Экзамен-симуляция');
    html += item('#/exam/themes', '🗂', 'По темам', THEMES.length);
    html += item('#/exam/random', '🔀', 'Тренировка');
    html += item('#/exam/blitz', '⚡', 'Молотилка');
    html += item('#/exam/mistakes', '🔁', 'Мои ошибки', Store.stats().mistakes || '');
    html += `</div><div class="nav-group"><div class="nav-group-title">Прогресс</div>`;
    html += item('#/progress', '📊', 'Статистика');
    html += `</div>`;
    nav.innerHTML = html;
  }

  /* -------------------------------------------------- HOME */
  function renderHome() {
    crumb.innerHTML = `<b>Главная</b>`;
    topActions.innerHTML = '';
    const st = Store.stats();
    const cats = CONTENT.categories.map(c => {
      const n = CONTENT.topics.filter(t => t.cat === c.id).length;
      const done = CONTENT.topics.filter(t => t.cat === c.id && Store.isRead(t.id)).length;
      return `<a class="cat-card" href="#/cat/${c.id}" data-link>
        <div class="cat-card__ico">${c.icon}</div>
        <div class="cat-card__title">${c.title}</div>
        <div class="cat-card__sub">${c.sub}</div>
        <div class="cat-card__meta"><span class="pill pill--cyan">${plural(n, ['тема', 'темы', 'тем'])}</span>${done ? `<span class="pill pill--green">✓ ${done}/${n}</span>` : ''}</div>
      </a>`;
    }).join('');
    view.innerHTML = `
      <section class="hero">
        <h1>Научись водить — и <span class="grad">понимай почему</span>, а не зубри</h1>
        <p>Механика машины простыми словами, логика ПДД через «зачем это придумали», и все <b>официальные билеты ГИБДД 2026</b> с разбором каждого ответа. Сначала суть — правило выводится само.</p>
        <div class="hero__cta">
          <a class="btn btn--primary" href="#/cat/mech" data-link>⚙️ Начать с механики</a>
          <a class="btn btn--amber" href="#/exam/blitz" data-link>⚡ Молотилка вопросов</a>
          <a class="btn btn--cyan" href="#/exam/sim" data-link>🎯 Пробный экзамен</a>
          <a class="btn btn--ghost" href="#/exam" data-link>📋 40 билетов</a>
        </div>
      </section>
      <div class="tiles">
        <div class="tile"><div class="tile__num amber">${POOL.length}</div><div class="tile__label">вопросов в билетах</div></div>
        <div class="tile"><div class="tile__num cyan">${CONTENT.topics.length}</div><div class="tile__label">обучающих тем</div></div>
        <div class="tile"><div class="tile__num green">${st.acc}%</div><div class="tile__label">твоя точность</div></div>
        <div class="tile"><div class="tile__num">${st.attempts}</div><div class="tile__label">отвечено</div></div>
      </div>
      <div class="section-title">📚 Разделы обучения</div>
      <div class="cat-grid">${cats}</div>
      <div class="section-title" style="margin-top:30px">📋 Билеты ${esc(TDATA.version || '2026')}</div>
      <div class="card"><p style="margin:0 0 14px;color:var(--text-2)">Официальные экзаменационные билеты категории ${esc(TDATA.category)} — 40 билетов по 20 вопросов, с картинками и официальными комментариями.</p>
      <div class="hero__cta"><a class="btn btn--primary" href="#/exam" data-link>Выбрать билет</a><a class="btn" href="#/exam/themes" data-link>Тренировать по темам</a></div></div>`;
  }

  /* -------------------------------------------------- CATEGORY */
  function renderCategory(id) {
    const cat = CONTENT.categories.find(c => c.id === id);
    if (!cat) return renderHome();
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <b>${cat.title}</b>`;
    topActions.innerHTML = '';
    const topics = CONTENT.topics.filter(t => t.cat === id);
    const rows = topics.map((t, i) => `
      <a class="topic-row" href="#/topic/${t.id}" data-link>
        <span class="topic-row__ico">${t.icon || '•'}</span>
        <span class="topic-row__body"><span class="topic-row__title">${i + 1}. ${esc(t.title)}</span>
          <span class="topic-row__sub">${esc(t.sub || '')} · ${t.minutes || 5} мин</span></span>
        <span class="topic-row__done">${Store.isRead(t.id) ? '✓' : ''}</span>
      </a>`).join('');
    view.innerHTML = `<div class="lesson-head"><h1>${cat.icon} ${cat.title}</h1><p style="color:var(--text-2)">${cat.sub}</p></div>
      <div class="topic-list">${rows || '<div class="empty">Скоро здесь будут темы.</div>'}</div>`;
  }

  /* -------------------------------------------------- SIGNS (справочник знаков) */
  function signRows(list, withCat) {
    return `<div class="sign-list">` + list.map(s => `<div class="sign-row">
      <img class="sign-row__img" src="assets/signs/sign_${s.num}.png" alt="${esc(s.num)}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="sign-row__body"><div class="sign-row__head"><span class="sign-row__num">${esc(s.num)}</span> <b>${esc(s.name)}</b>${withCat ? ` <span class="sign-row__cat">${esc(s.cat)}</span>` : ''}</div>
      <div class="sign-row__txt">${s.explain || ''}</div></div></div>`).join('') + `</div>`;
  }
  function renderSignsHub() {
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <b>Дорожные знаки</b>`;
    topActions.innerHTML = '';
    const cards = SIGNS.map(c => `<a class="cat-card" href="#/signs/${c.slug}" data-link>
      <div class="cat-card__ico">${c.icon}</div>
      <div class="cat-card__title">${esc(c.title)}</div>
      <div class="cat-card__meta"><span class="pill pill--cyan">${plural(c.signs.length, ['знак', 'знака', 'знаков'])}</span></div>
    </a>`).join('');
    view.innerHTML = `
      <div class="lesson-head"><h1>🚸 Дорожные знаки</h1><p style="color:var(--text-2)">Все ${signsCount} знаков по разделам — с картинкой и кратким объяснением. Можно искать по номеру или названию.</p></div>
      <input id="signSearch" class="sign-search" type="search" placeholder="🔎 Поиск: номер или название (3.24, обгон, парковка…)" autocomplete="off">
      <div id="signResults"></div>
      <div id="signCats"><div class="cat-grid">${cards}</div></div>`;
    const all = SIGNS.flatMap(c => c.signs.map(s => ({ ...s, cat: c.title })));
    const inp = $('#signSearch'), res = $('#signResults'), catsEl = $('#signCats');
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { res.innerHTML = ''; catsEl.style.display = ''; return; }
      catsEl.style.display = 'none';
      const m = all.filter(s => s.num.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
      res.innerHTML = `<div class="section-title">Найдено: ${m.length}</div>` + (m.length ? signRows(m, true) : '<div class="empty">Ничего не найдено</div>');
    };
  }
  function renderSignsCat(slug) {
    const c = SIGNS.find(x => x.slug === slug); if (!c) return renderSignsHub();
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <a href="#/signs" data-link>Знаки</a> <span>›</span> <b>${esc(c.title)}</b>`;
    topActions.innerHTML = '';
    view.innerHTML = `<div class="lesson-head"><h1>${c.icon} ${esc(c.title)}</h1><div class="lesson-meta"><span class="pill">${plural(c.signs.length, ['знак', 'знака', 'знаков'])}</span></div></div>${signRows(c.signs, false)}`;
    window.scrollTo(0, 0);
  }

  /* -------------------------------------------------- TOPIC / LESSON */
  function renderTopic(id) {
    const idx = CONTENT.topics.findIndex(t => t.id === id);
    const t = CONTENT.topics[idx];
    if (!t) return renderHome();
    const cat = CONTENT.categories.find(c => c.id === t.cat);
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <a href="#/cat/${cat.id}" data-link>${cat.title}</a> <span>›</span> <b>${esc(t.title)}</b>`;
    topActions.innerHTML = '';
    const prev = CONTENT.topics[idx - 1], next = CONTENT.topics[idx + 1];
    view.innerHTML = `
      <article class="lesson">
        <div class="lesson-head">
          <h1>${t.icon || ''} ${esc(t.title)}</h1>
          <div class="lesson-meta"><span class="pill pill--amber">${cat.title}</span><span class="pill">⏱ ${t.minutes || 5} мин</span>${Store.isRead(t.id) ? '<span class="pill pill--green">✓ прочитано</span>' : ''}</div>
        </div>
        <div class="prose">${t.html}</div>
        ${(() => { const n = t.theme ? POOL.filter(q => q.theme === t.theme).length : 0; return n ? `<a class="theme-cta" href="#/exam/theme/${themeSlug(t.theme)}" data-link><span><b>🎯 Потренируй эту тему</b><br><span class="theme-cta__sub">${esc(t.theme)} · ${n} вопросов из билетов ГИБДД</span></span><span class="theme-cta__go">→</span></a><a class="theme-cta theme-cta--blitz" href="#/exam/blitz/theme/${themeSlug(t.theme)}" data-link><span><b>⚡ Молотилка по теме</b><br><span class="theme-cta__sub">быстрый прогон потоком · умный порядок</span></span><span class="theme-cta__go">→</span></a>` : ''; })()}
        <div id="topicQuiz"></div>
        <div class="q-nav" style="margin-top:34px">
          ${prev ? `<a class="btn" href="#/topic/${prev.id}" data-link>← ${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="btn btn--primary" href="#/topic/${next.id}" data-link>${esc(next.title)} →</a>` : `<a class="btn btn--primary" href="#/cat/${cat.id}" data-link>К разделу →</a>`}
        </div>
      </article>`;
    // mount widgets
    view.querySelectorAll('[data-widget]').forEach(el => {
      const name = el.getAttribute('data-widget');
      if (window.Widgets && window.Widgets[name]) { try { const c = window.Widgets[name](el); if (typeof c === 'function') cleanups.push(c); } catch (e) { console.error('widget', name, e); } }
    });
    Store.markRead(t.id); renderNav();
    // topic self-check quiz
    if (t.quiz && t.quiz.length) {
      const qEl = $('#topicQuiz');
      qEl.innerHTML = `<div class="section-title" style="margin-top:36px">🧠 Проверь себя <span class="pill">${t.quiz.length}</span></div>`;
      const host = document.createElement('div'); qEl.appendChild(host);
      const qs = t.quiz.map((q, i) => ({ q: q.q, options: q.options, correct: q.correct, explain: q.explain, theme: cat.title, key: `topic-${t.id}-${i}` }));
      runQuiz(host, qs, { mode: 'practice', compact: true });
    }
    window.scrollTo(0, 0);
  }

  /* -------------------------------------------------- EXAM HUB */
  function renderExamHub() {
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <b>Билеты ПДД 2026</b>`;
    topActions.innerHTML = `<a class="btn btn--sm btn--primary" href="#/exam/sim" data-link>🎯 Экзамен</a>`;
    const cards = TDATA.tickets.map(t => {
      const best = Store.data.ticketBest[t.num];
      return `<a class="mini-card" href="#/exam/ticket/${t.num}" data-link>
        <div class="mini-card__big">${t.num}</div><div class="mini-card__sub">билет</div>
        ${best != null ? `<div class="ring" style="color:${best >= 18 ? 'var(--green)' : best >= 14 ? 'var(--amber)' : 'var(--red)'}">${best}/20</div>` : '<div class="ring">—</div>'}
      </a>`;
    }).join('');
    view.innerHTML = `
      <div class="lesson-head"><h1>📋 Экзаменационные билеты</h1>
        <div class="lesson-meta"><span class="pill pill--amber">${esc(TDATA.version)}</span><span class="pill">кат. ${esc(TDATA.category)}</span><span class="pill">${POOL.length} вопросов</span></div></div>
      <div class="card" style="margin-bottom:22px"><div style="display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn--primary" href="#/exam/sim" data-link>🎯 Экзамен-симуляция (правила 2026)</a>
        <a class="btn btn--amber" href="#/exam/blitz" data-link>⚡ Молотилка</a>
        <a class="btn btn--cyan" href="#/exam/random" data-link>🔀 Случайная тренировка</a>
        <a class="btn" href="#/exam/themes" data-link>🗂 По темам</a>
        <a class="btn" href="#/exam/mistakes" data-link>🔁 Мои ошибки (${Store.stats().mistakes})</a>
      </div></div>
      <div class="section-title">Выбери билет</div>
      <div class="grid-cards">${cards}</div>`;
  }

  function renderThemes() {
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <a href="#/exam" data-link>Билеты</a> <span>›</span> <b>Темы</b>`;
    topActions.innerHTML = '';
    const rows = THEMES.map(t => {
      const qs = POOL.filter(q => q.theme === t);
      const keys = qs.map(q => q.key);
      const seen = keys.filter(k => Store.data.q[k]);
      const ok = seen.filter(k => Store.data.q[k].ok > 0).length;
      const acc = seen.length ? Math.round(ok / seen.length * 100) : 0;
      return `<a class="topic-row" href="#/exam/theme/${themeSlug(t)}" data-link>
        <span class="topic-row__ico">🗂</span>
        <span class="topic-row__body"><span class="topic-row__title">${esc(t)}</span>
          <span class="topic-row__sub">${qs.length} вопросов${seen.length ? ` · пройдено ${seen.length}, точность ${acc}%` : ''}</span></span>
        <span class="topic-row__done" style="color:var(--text-3);font-family:var(--mono);font-size:13px">${qs.length}</span>
      </a>`;
    }).join('');
    view.innerHTML = `<div class="lesson-head"><h1>🗂 Тренировка по темам</h1><p style="color:var(--text-2)">Официальная тематика билетов — отрабатывай слабые места точечно.</p></div>
      <div class="blitz-modes"><a class="blitz-mode is-active" href="#/exam/themes" data-link>📋 Обычный разбор</a><a class="blitz-mode" href="#/exam/blitz/themes" data-link>⚡ Гонять молотилкой</a></div>
      <div class="topic-list">${rows}</div>`;
  }

  /* -------------------------------------------------- QUIZ ENGINE */
  function runQuiz(host, questions, opts) {
    opts = opts || {};
    const mode = opts.mode || 'practice';   // practice | ticket | exam
    const timed = mode === 'exam';
    let list = questions.slice();
    let i = 0, answered = 0, correct = 0, errors = 0, extraBlocks = 0, finished = false;
    const results = {};                      // index -> {chosen, ok}
    let timeLeft = (opts.minutes || 20) * 60, timer = null;

    const wrap = document.createElement('div'); host.appendChild(wrap);

    function startTimer() {
      if (!timed) return;
      timer = setInterval(() => {
        timeLeft--; const tEl = $('.exam-bar__timer', wrap);
        if (tEl) { tEl.textContent = fmtTime(timeLeft); tEl.classList.toggle('danger', timeLeft < 60); }
        if (timeLeft <= 0) { clearInterval(timer); finish('⏰ Время вышло'); }
      }, 1000);
      cleanups.push(() => clearInterval(timer));
    }

    function bar() {
      if (!timed && !opts.showBar) return '';
      const dots = list.map((q, k) => {
        const r = results[k];
        const cls = r ? (r.ok ? 'is-ok' : 'is-err') : (k === i ? 'is-current' : '');
        return `<span class="dot ${cls}" data-jump="${k}">${k + 1}</span>`;
      }).join('');
      return `<div class="exam-bar">
        ${timed ? `<span class="exam-bar__timer">${fmtTime(timeLeft)}</span>` : ''}
        <div class="exam-bar__progress"><div class="dotbar">${dots}</div></div>
        <div class="exam-bar__counts"><span class="ok">✓ ${correct}</span><span class="err">✗ ${errors}</span><span>${answered}/${list.length}</span></div>
      </div>`;
    }

    function render() {
      if (finished) return;
      const q = list[i];
      const r = results[i];
      const locked = !!r;
      wrap.innerHTML = bar() + `
        <div class="card q-card">
          <div class="q-head"><span class="q-num">Вопрос ${i + 1}${timed ? '' : ' / ' + list.length}</span>
            ${q.theme ? `<span class="q-theme">${esc(q.theme)}</span>` : ''}</div>
          ${q.img ? `<img class="q-img" src="${q.img}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="q-text">${esc(q.q)}</div>
          <div class="options">${q.options.map((o, k) => {
            let cls = '';
            if (locked) { if (k === q.correct) cls = 'is-correct'; else if (k === r.chosen) cls = 'is-wrong'; cls += ' is-locked'; }
            return `<button class="option ${cls}" data-opt="${k}"><span class="option__key">${k + 1}</span><span>${esc(o)}</span></button>`;
          }).join('')}</div>
          ${locked ? `<div class="q-explain"><div class="q-explain__label">${r.ok ? '✓ Верно' : '✗ Правильный ответ: ' + (q.correct + 1)}</div><p>${esc(q.explain || '')}</p>${q.pddRef ? `<p style="margin-top:6px;color:var(--text-3)">📖 Пункт/знак ПДД: ${esc(q.pddRef)}</p>` : ''}</div>` : ''}
          <div class="q-nav">
            <button class="btn" data-prev ${i === 0 ? 'disabled' : ''}>← Назад</button>
            ${locked || mode === 'practice'
          ? `<button class="btn btn--primary" data-next>${i + 1 >= list.length ? 'Завершить' : 'Дальше →'}</button>`
          : '<span style="color:var(--text-3);align-self:center;font-size:13px">выбери ответ</span>'}
          </div>
        </div>`;
      wrap.querySelectorAll('.option').forEach(b => b.onclick = () => { if (!results[i]) choose(parseInt(b.dataset.opt)); });
      const nx = $('[data-next]', wrap), pv = $('[data-prev]', wrap);
      if (nx) nx.onclick = next;
      if (pv) pv.onclick = () => { if (i > 0) { i--; render(); } };
      wrap.querySelectorAll('[data-jump]').forEach(d => d.onclick = () => { i = parseInt(d.dataset.jump); render(); });
      if (!opts.compact) window.scrollTo(0, 0);
    }

    function choose(k) {
      const q = list[i];
      const ok = k === q.correct;
      results[i] = { chosen: k, ok };
      answered++; if (ok) correct++; else errors++;
      const isExtra = q._extra;
      Store.answer(q.key || `tmp-${i}`, ok, ok ? null : { q: q.q, img: q.img, options: q.options, correct: q.correct, explain: q.explain, theme: q.theme, pddRef: q.pddRef, key: q.key });
      // 2026 exam rules: mistakes add 5 extra; error on extra or 3rd error => fail
      if (mode === 'exam' && !ok) {
        if (isExtra) { render(); return finish('fail'); }
        if (errors > 2) { render(); return finish('fail'); }
        const used = new Set(list.map(x => x.key));
        const extra = shuffle(POOL.filter(x => x.theme === q.theme && !used.has(x.key))).slice(0, 5).map(x => ({ ...x, _extra: true }));
        list = list.concat(extra); extraBlocks++; timeLeft += 5 * 60;
      }
      render();
    }

    function next() {
      if (i + 1 >= list.length) { return mode === 'exam' ? finish('done') : finish('practice'); }
      i++; render();
    }

    function finish(reason) {
      if (finished) return; finished = true;
      if (timer) clearInterval(timer);
      const total = list.length;
      const pass = mode === 'exam' ? (reason === 'done' && errors <= 2) : null;
      if (opts.ticket) Store.setTicketBest(opts.ticket, correct);
      if (mode === 'exam') Store.addExam(correct, total, !!pass);
      renderNav();
      if (mode === 'practice' && !opts.summary) {
        wrap.innerHTML = `<div class="result"><div class="result__icon">${correct === total ? '🏆' : '✅'}</div>
          <div class="result__title">Готово</div>
          <div class="result__score">Верно ${correct} из ${total} · точность ${Math.round(correct / total * 100)}%</div>
          <div class="result__actions"><button class="btn btn--primary" data-retry>Ещё раз</button></div></div>`;
        $('[data-retry]', wrap).onclick = () => { i = 0; answered = correct = errors = 0; Object.keys(results).forEach(k => delete results[k]); list = shuffle(questions); finished = false; render(); };
        return;
      }
      const acc = Math.round(correct / total * 100);
      wrap.innerHTML = `<div class="result">
        <div class="result__icon">${pass ? '🎉' : '🚫'}</div>
        <div class="result__title ${pass ? 'pass' : 'fail'}">${pass ? 'Экзамен сдан!' : reason === '⏰ Время вышло' ? 'Время вышло' : 'Не сдан'}</div>
        <div class="result__score">Верно <b>${correct}</b> из <b>${total}</b> · ошибок ${errors} · точность ${acc}%${extraBlocks ? ` · доп.вопросов: ${extraBlocks * 5}` : ''}</div>
        <p style="color:var(--text-3);max-width:46ch;margin:14px auto 0">${pass ? 'На реальном экзамене допускается не более 2 ошибок, каждая добавляет 5 доп.вопросов без права на ошибку.' : 'Разбери ошибки — они сохранены в разделе «Мои ошибки».'}</p>
        <div class="result__actions">
          <button class="btn btn--primary" data-again>Заново</button>
          <a class="btn" href="#/exam/mistakes" data-link>🔁 Разбор ошибок</a>
          <a class="btn btn--ghost" href="#/exam" data-link>К билетам</a>
        </div></div>`;
      $('[data-again]', wrap).onclick = () => opts.restart && opts.restart();
    }

    startTimer(); render();
  }

  /* -------------------------------------------------- BLITZ (молотилка) */
  // Бесконечный быстрый прогон: ответил → мгновенный фидбэк → автопереход.
  // Клавиши 1–9 — ответ, Enter/Пробел — дальше. Серия (streak), spaced-repetition
  // ошибок, интеграция со Store (ошибки и статистика учитываются как везде).
  function runBlitz(pool, opts) {
    opts = opts || {};
    const smart = opts.smart !== false;
    const active = opts.active || 'all';
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <b>${esc(opts.crumb || 'Молотилка')}</b>`;
    topActions.innerHTML = '';
    const tab = (h, label) => `<a class="blitz-mode ${active === h ? 'is-active' : ''}" href="#/exam/blitz${h === 'all' ? '' : '/' + h}" data-link>${label}</a>`;
    view.innerHTML = `
      <div class="lesson-head"><h1>${opts.title || '⚡ Молотилка'}</h1>
        <div class="lesson-meta"><span class="pill">${pool.length} вопросов · поток без конца</span>
          ${smart ? '<span class="pill pill--cyan">🧠 умный порядок: слабое вперёд</span>' : ''}
          <span class="pill pill--amber">клавиши <b>1–4</b> · <b>Enter</b> дальше</span></div></div>
      <div class="blitz-modes">${tab('all', '🎲 Все вопросы')}${tab('themes', '🗂 По темам')}${tab('mistakes', '🔁 Мои ошибки')}</div>
      <div id="blitzStats" class="blitz-bar"></div>
      <div id="blitzHost"></div>`;
    const host = $('#blitzHost'), statsEl = $('#blitzStats');
    let queue = [], cur = null, locked = false, advTimer = null;
    const sess = { answered: 0, correct: 0, streak: 0, best: 0 };
    const mastered = new Set();

    // приоритет вопроса для умного порядка: меньше = раньше
    function priority(q) {
      if (Store.data.mistakes[q.key]) return 0;            // ошибался — в первую очередь
      const st = Store.data.q[q.key];
      if (!st) return 1;                                    // ещё не видел
      if (st.ok < st.seen) return 2;                        // были осечки
      return 3;                                              // освоено
    }
    function refill() {
      let avail = pool.filter(q => !mastered.has(q.key));
      if (!avail.length) { mastered.clear(); avail = pool.slice(); }
      if (!smart) { queue = shuffle(avail); return; }
      // взвешенно-случайный порядок: слабое/ошибки выпадают чаще, но порядок
      // каждый раз разный (первый вопрос не повторяется). Вес по приоритету:
      const W = [8, 5, 3, 1];                       // ошибка, не видел, были осечки, освоено
      queue = avail
        .map(q => ({ q, k: Math.pow(Math.random(), 1 / W[priority(q)]) }))
        .sort((a, b) => b.k - a.k)
        .map(x => x.q);
    }
    function nextQ() {
      if (advTimer) { clearTimeout(advTimer); advTimer = null; }
      locked = false;
      if (!queue.length) refill();
      cur = queue.shift();
      render();
    }
    function renderStats() {
      const acc = sess.answered ? Math.round(sess.correct / sess.answered * 100) : 0;
      const rec = Math.max(sess.best, Store.data.blitzBest || 0);
      statsEl.innerHTML = `
        <div class="blitz-stat blitz-stat--streak ${sess.streak >= 5 ? 'hot' : ''}"><span class="blitz-stat__n">🔥 ${sess.streak}</span><span class="blitz-stat__l">серия</span></div>
        <div class="blitz-stat"><span class="blitz-stat__n">🏆 ${rec}</span><span class="blitz-stat__l">рекорд</span></div>
        <div class="blitz-stat"><span class="blitz-stat__n ok">✓ ${sess.correct}</span><span class="blitz-stat__l">верно</span></div>
        <div class="blitz-stat"><span class="blitz-stat__n err">✗ ${sess.answered - sess.correct}</span><span class="blitz-stat__l">мимо</span></div>
        <div class="blitz-stat"><span class="blitz-stat__n">${acc}%</span><span class="blitz-stat__l">точность</span></div>`;
    }
    function render() {
      renderStats();
      const q = cur;
      host.innerHTML = `<div class="card q-card blitz-card">
        <div class="q-head"><span class="q-num">№ ${sess.answered + 1}</span>${q.theme ? `<span class="q-theme">${esc(q.theme)}</span>` : ''}</div>
        ${q.img ? `<img class="q-img" src="${q.img}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="q-text">${esc(q.q)}</div>
        <div class="options">${q.options.map((o, k) => `<button class="option" data-opt="${k}"><span class="option__key">${k + 1}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div id="blitzExplain"></div>
      </div>`;
      host.querySelectorAll('.option').forEach(b => b.onclick = () => choose(parseInt(b.dataset.opt)));
      if (!opts.compact) window.scrollTo(0, 0);
    }
    function choose(k) {
      if (locked) return;
      locked = true;
      const q = cur, ok = k === q.correct;
      sess.answered++;
      if (ok) {
        sess.correct++; sess.streak++; sess.best = Math.max(sess.best, sess.streak); mastered.add(q.key);
        if (sess.best > (Store.data.blitzBest || 0)) { Store.data.blitzBest = sess.best; Store.save(); }
      } else { sess.streak = 0; }
      Store.answer(q.key || `blitz-${sess.answered}`, ok, ok ? null : { q: q.q, img: q.img, options: q.options, correct: q.correct, explain: q.explain, theme: q.theme, pddRef: q.pddRef, key: q.key });
      host.querySelectorAll('.option').forEach((b, idx) => {
        b.classList.add('is-locked');
        if (idx === q.correct) b.classList.add('is-correct');
        else if (idx === k) b.classList.add('is-wrong');
      });
      renderStats(); renderNav();
      if (ok) {
        advTimer = setTimeout(nextQ, 650);
      } else {
        // ошибку вернём в очередь через несколько вопросов — закрепить
        const back = Math.min(queue.length, 6 + Math.floor(Math.random() * 6));
        queue.splice(back, 0, q);
        $('#blitzExplain').innerHTML = `<div class="q-explain"><div class="q-explain__label">✗ Правильный ответ: ${q.correct + 1}</div><p>${esc(q.explain || '')}</p>${q.pddRef ? `<p style="margin-top:6px;color:var(--text-3)">📖 Пункт/знак ПДД: ${esc(q.pddRef)}</p>` : ''}</div>
          <div class="q-nav"><button class="btn btn--primary" data-next>Дальше → <span class="kbd">Enter</span></button></div>`;
        $('[data-next]').onclick = nextQ;
      }
    }
    function onKey(e) {
      if (e.key >= '1' && e.key <= '9') {
        const k = parseInt(e.key) - 1;
        if (!locked && cur && k < cur.options.length) { e.preventDefault(); choose(k); }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (locked) { e.preventDefault(); nextQ(); }
      }
    }
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));
    cleanups.push(() => { if (advTimer) clearTimeout(advTimer); });
    nextQ();
  }

  /* -------------------------------------------------- exam launchers */
  function examTicket(n) {
    const t = TDATA.tickets.find(x => x.num == n); if (!t) return renderHome();
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <b>Билет ${n}</b>`;
    topActions.innerHTML = '';
    view.innerHTML = `<div class="lesson-head"><h1>Билет ${n}</h1><div class="lesson-meta"><span class="pill pill--amber">20 вопросов</span><span class="pill">разбор после каждого</span></div></div>`;
    const host = document.createElement('div'); view.appendChild(host);
    const qs = t.questions.map((q, idx) => ({ ...q, key: `t${n}-${idx}` }));
    runQuiz(host, qs, { mode: 'ticket', showBar: true, ticket: n, restart: () => examTicket(n) });
  }
  function examSim() {
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <b>Экзамен-симуляция</b>`;
    topActions.innerHTML = '';
    view.innerHTML = `<div class="lesson-head"><h1>🎯 Экзамен-симуляция</h1><div class="lesson-meta"><span class="pill pill--amber">20 вопросов · 20 мин</span><span class="pill pill--red">≤ 2 ошибок</span><span class="pill">правила 2026</span></div></div>`;
    const host = document.createElement('div'); view.appendChild(host);
    const qs = shuffle(POOL).slice(0, 20);
    runQuiz(host, qs, { mode: 'exam', minutes: 20, restart: examSim });
  }
  function examRandom() {
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <b>Тренировка</b>`;
    topActions.innerHTML = '';
    view.innerHTML = `<div class="lesson-head"><h1>🔀 Случайная тренировка</h1><div class="lesson-meta"><span class="pill">20 случайных · разбор сразу</span></div></div>`;
    const host = document.createElement('div'); view.appendChild(host);
    runQuiz(host, shuffle(POOL).slice(0, 20), { mode: 'practice', showBar: true });
  }
  function examTheme(slug) {
    let dec = slug; try { dec = decodeURIComponent(slug); } catch (e) {}
    const theme = byThemeSlug[dec] || byThemeSlug[slug]; if (!theme) return renderThemes();
    crumb.innerHTML = `<a href="#/exam/themes" data-link>Темы</a> <span>›</span> <b>${esc(theme)}</b>`;
    topActions.innerHTML = '';
    view.innerHTML = `<div class="lesson-head"><h1>🗂 ${esc(theme)}</h1><div class="lesson-meta"><span class="pill">${POOL.filter(q => q.theme === theme).length} вопросов · разбор сразу</span></div></div>`;
    const host = document.createElement('div'); view.appendChild(host);
    runQuiz(host, shuffle(POOL.filter(q => q.theme === theme)), { mode: 'practice', showBar: true });
  }
  function examMistakes() {
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <b>Мои ошибки</b>`;
    topActions.innerHTML = '';
    const ms = Store.mistakes();
    view.innerHTML = `<div class="lesson-head"><h1>🔁 Мои ошибки</h1><div class="lesson-meta"><span class="pill pill--red">${ms.length} вопросов</span></div></div>`;
    const host = document.createElement('div'); view.appendChild(host);
    if (!ms.length) { host.innerHTML = `<div class="empty"><div class="empty__ico">🎉</div>Ошибок нет! Прорешай билеты или симуляцию — сюда попадут вопросы, где ошибёшься, чтобы их закрепить.</div>`; return; }
    runQuiz(host, shuffle(ms), { mode: 'practice', showBar: true });
  }
  function examBlitz() { runBlitz(POOL, { crumb: 'Молотилка', title: '⚡ Молотилка', active: 'all' }); }
  function examBlitzMistakes() {
    const ms = Store.mistakes();
    if (!ms.length) return examMistakes();
    runBlitz(ms, { crumb: 'Молотилка ошибок', title: '⚡ Молотилка ошибок', active: 'mistakes' });
  }
  function examBlitzTheme(slug) {
    let dec = slug; try { dec = decodeURIComponent(slug); } catch (e) {}
    const theme = byThemeSlug[dec] || byThemeSlug[slug]; if (!theme) return renderBlitzThemes();
    runBlitz(POOL.filter(q => q.theme === theme), { crumb: `Молотилка · ${theme}`, title: `⚡ ${esc(theme)}`, active: 'themes' });
  }
  function renderBlitzThemes() {
    crumb.innerHTML = `<a href="#/exam" data-link>Билеты</a> <span>›</span> <a href="#/exam/blitz" data-link>Молотилка</a> <span>›</span> <b>По темам</b>`;
    topActions.innerHTML = '';
    const rows = THEMES.map(t => {
      const qs = POOL.filter(q => q.theme === t);
      const keys = qs.map(q => q.key);
      const seen = keys.filter(k => Store.data.q[k]);
      const ok = seen.filter(k => Store.data.q[k].ok > 0).length;
      const acc = seen.length ? Math.round(ok / seen.length * 100) : 0;
      const weak = keys.filter(k => Store.data.mistakes[k]).length;
      return `<a class="topic-row" href="#/exam/blitz/theme/${themeSlug(t)}" data-link>
        <span class="topic-row__ico">⚡</span>
        <span class="topic-row__body"><span class="topic-row__title">${esc(t)}</span>
          <span class="topic-row__sub">${qs.length} вопросов${seen.length ? ` · точность ${acc}%` : ''}${weak ? ` · 🔁 ${weak} в ошибках` : ''}</span></span>
        <span class="topic-row__done" style="color:${acc >= 80 ? 'var(--green)' : acc >= 50 ? 'var(--amber)' : 'var(--text-3)'};font-family:var(--mono);font-size:13px">${seen.length ? acc + '%' : qs.length}</span>
      </a>`;
    }).join('');
    view.innerHTML = `<div class="lesson-head"><h1>⚡ Молотилка по темам</h1><p style="color:var(--text-2)">Гоняй вопросы одной темы потоком. Внутри — умный порядок: ошибки и непройденное вперёд.</p></div>
      <div class="blitz-modes"><a class="blitz-mode" href="#/exam/blitz" data-link>🎲 Все вопросы</a><a class="blitz-mode is-active" href="#/exam/blitz/themes" data-link>🗂 По темам</a><a class="blitz-mode" href="#/exam/blitz/mistakes" data-link>🔁 Мои ошибки</a></div>
      <div class="topic-list">${rows}</div>`;
  }

  /* -------------------------------------------------- PROGRESS */
  function renderProgress() {
    crumb.innerHTML = `<a href="#/" data-link>Главная</a> <span>›</span> <b>Статистика</b>`;
    topActions.innerHTML = `<button class="btn btn--sm btn--ghost" id="resetBtn">Сбросить прогресс</button>`;
    const st = Store.stats();
    const themeStats = THEMES.map(t => {
      const keys = POOL.filter(q => q.theme === t).map(q => q.key);
      const seen = keys.filter(k => Store.data.q[k]);
      if (!seen.length) return null;
      const ok = seen.reduce((a, k) => a + (Store.data.q[k].ok > 0 ? 1 : 0), 0);
      return { t, acc: Math.round(ok / seen.length * 100), seen: seen.length, total: keys.length };
    }).filter(Boolean).sort((a, b) => a.acc - b.acc);
    const bars = themeStats.length ? themeStats.map(s => `
      <div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${esc(s.t)}</span><span style="font-family:var(--mono);color:${s.acc >= 80 ? 'var(--green)' : s.acc >= 50 ? 'var(--amber)' : 'var(--red)'}">${s.acc}% (${s.seen}/${s.total})</span></div>
      <div class="progress"><div class="progress__bar" style="width:${s.acc}%;background:${s.acc >= 80 ? 'var(--green)' : s.acc >= 50 ? 'var(--amber)' : 'var(--red)'}"></div></div></div>`).join('') : '<div class="empty">Пройди вопросы — здесь появится точность по темам.</div>';
    const exams = Store.data.exams.length ? Store.data.exams.slice(0, 10).map(e => `
      <tr><td>${new Date(e.d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${e.score}/${e.total}</td><td><span class="pill ${e.pass ? 'pill--green' : 'pill--red'}">${e.pass ? 'сдан' : 'не сдан'}</span></td></tr>`).join('') : '<tr><td colspan="3" style="color:var(--text-3)">Пока нет попыток</td></tr>';
    view.innerHTML = `
      <div class="lesson-head"><h1>📊 Твоя статистика</h1></div>
      <div class="tiles">
        <div class="tile"><div class="tile__num cyan">${st.read}</div><div class="tile__label">тем прочитано</div></div>
        <div class="tile"><div class="tile__num amber">${st.answered}</div><div class="tile__label">уникальных вопросов</div></div>
        <div class="tile"><div class="tile__num green">${st.acc}%</div><div class="tile__label">точность</div></div>
        <div class="tile"><div class="tile__num">${st.examsPassed}</div><div class="tile__label">экзаменов сдано</div></div>
      </div>
      <div class="section-title">📥 Офлайн-доступ</div>
      <div class="card">
        <p style="margin:0 0 12px;color:var(--text-2)">Скачай все уроки, билеты и <b>картинки</b> в память телефона — заниматься можно будет без интернета (в дороге, в метро).</p>
        <div class="progress" style="margin-bottom:12px"><div class="progress__bar" id="offBar" style="width:0%;background:var(--green)"></div></div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <button class="btn btn--primary" id="offBtn">📥 Скачать всё для офлайна</button>
          <span id="offStatus" style="font-size:13px;color:var(--text-3)">${hasSW ? 'Проверяю…' : 'Доступно после установки на экран «Домой»'}</span>
        </div>
      </div>
      <div class="section-title">🎯 Точность по темам <span class="pill">слабые сверху</span></div>
      <div class="card">${bars}</div>
      <div class="section-title">🕑 История экзаменов</div>
      <div class="card"><table class="table"><thead><tr><th>Дата</th><th>Результат</th><th>Итог</th></tr></thead><tbody>${exams}</tbody></table></div>`;
    $('#resetBtn').onclick = () => { if (confirm('Сбросить весь прогресс?')) { localStorage.removeItem(KEY); Store.load(); renderNav(); renderProgress(); } };

    // офлайн-докачка с прогрессом
    const offBtn = $('#offBtn'), offBar = $('#offBar'), offStatus = $('#offStatus');
    if (hasSW && offBtn) {
      const setOff = (cached, total, busy) => {
        const pct = total ? Math.round(cached / total * 100) : 0;
        offBar.style.width = pct + '%';
        if (busy) { offStatus.textContent = `Скачиваю… ${cached}/${total}`; }
        else if (total && cached >= total) { offStatus.textContent = `✓ Готово к офлайну · ${cached}/${total}`; offBtn.textContent = '✅ Всё скачано'; offBtn.disabled = false; }
        else { offStatus.textContent = `В памяти ${cached}/${total || '?'}`; offBtn.textContent = cached ? '📥 Докачать для офлайна' : '📥 Скачать всё для офлайна'; offBtn.disabled = false; }
      };
      offlineUI = (m) => {
        if (m.type === 'precacheProgress') setOff(m.cached, m.total, true);
        else if (m.type === 'precacheDone') setOff(m.cached, m.total, false);
        else if (m.type === 'cacheStatus') setOff(m.cached, m.total, false);
      };
      offBtn.onclick = () => { offBtn.disabled = true; offStatus.textContent = 'Запускаю…'; swSend({ type: 'precacheAll' }); };
      swSend({ type: 'cacheStatus' });
      cleanups.push(() => { offlineUI = null; });
    }
  }

  /* -------------------------------------------------- ROUTER */
  function router() {
    clearView();
    const h = location.hash || '#/';
    const parts = h.replace(/^#\//, '').split('/');
    app.classList.remove('nav-open');
    if (h === '#/' || parts[0] === '') renderHome();
    else if (parts[0] === 'cat') renderCategory(parts[1]);
    else if (parts[0] === 'signs' && parts[1]) renderSignsCat(parts[1]);
    else if (parts[0] === 'signs') renderSignsHub();
    else if (parts[0] === 'topic') renderTopic(parts[1]);
    else if (parts[0] === 'exam' && !parts[1]) renderExamHub();
    else if (parts[0] === 'exam' && parts[1] === 'sim') examSim();
    else if (parts[0] === 'exam' && parts[1] === 'random') examRandom();
    else if (parts[0] === 'exam' && parts[1] === 'blitz' && parts[2] === 'mistakes') examBlitzMistakes();
    else if (parts[0] === 'exam' && parts[1] === 'blitz' && parts[2] === 'themes') renderBlitzThemes();
    else if (parts[0] === 'exam' && parts[1] === 'blitz' && parts[2] === 'theme') examBlitzTheme(parts[3]);
    else if (parts[0] === 'exam' && parts[1] === 'blitz') examBlitz();
    else if (parts[0] === 'exam' && parts[1] === 'themes') renderThemes();
    else if (parts[0] === 'exam' && parts[1] === 'theme') examTheme(parts[2]);
    else if (parts[0] === 'exam' && parts[1] === 'mistakes') examMistakes();
    else if (parts[0] === 'exam' && parts[1] === 'ticket') examTicket(parts[2]);
    else if (parts[0] === 'progress') renderProgress();
    else renderHome();
    renderNav();
  }

  // intercept data-link clicks for smoothness (hash nav works anyway)
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (a) { /* default hash nav */ app.classList.remove('nav-open'); }
  });
  $('#menuBtn').onclick = () => app.classList.toggle('nav-open');
  $('#backdrop').onclick = () => app.classList.remove('nav-open');

  /* -------------------------------------------------- term glossary popover */
  (function termPopover() {
    const pop = document.createElement('div');
    pop.className = 'termpop'; document.body.appendChild(pop);
    let openEl = null;
    const norm = s => (s || '').replace(/[«»"']/g, '').replace(/—/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    function show(el) {
      const def = (window.GLOSSARY || {})[norm(el.textContent)];
      if (!def) { hide(); return; }
      if (openEl && openEl !== el) openEl.classList.remove('is-open');
      pop.innerHTML = `<span class="termpop__t">${esc(el.textContent)}</span>${esc(def)}<span class="termpop__hint">нажми ещё раз, чтобы закрыть</span>`;
      const pw = Math.min(320, window.innerWidth - 24);
      pop.style.maxWidth = pw + 'px';
      pop.classList.add('show');
      const r = el.getBoundingClientRect(), ph = pop.offsetHeight;
      let left = Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - pw - 12);
      left = Math.max(window.scrollX + 12, left);
      let top = r.bottom + window.scrollY + 8;
      if (r.bottom + ph + 14 > window.innerHeight) top = r.top + window.scrollY - ph - 8;
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      el.classList.add('is-open'); openEl = el;
    }
    function hide() { pop.classList.remove('show'); if (openEl) openEl.classList.remove('is-open'); openEl = null; }
    document.addEventListener('click', e => {
      const t = e.target.closest('.term');
      if (t) { e.preventDefault(); (openEl === t) ? hide() : show(t); return; }
      if (!e.target.closest('.termpop')) hide();
    });
    document.addEventListener('scroll', () => { if (openEl) hide(); }, true);
    if (window.matchMedia('(hover:hover)').matches) {
      document.addEventListener('mouseover', e => { const t = e.target.closest('.term'); if (t && t !== openEl) show(t); });
      document.addEventListener('mouseout', e => { const t = e.target.closest('.term'); if (t && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.termpop'))) hide(); });
    }
  })();

  window.addEventListener('hashchange', router);
  renderNav(); router();
})();
