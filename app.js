/* 우리집 냉장고 — 냉장고 재고 · 주간 식단 · 식비 가계부
   모든 데이터는 이 브라우저의 localStorage에만 저장됩니다. */
(function () {
  'use strict';

  var KEY = 'homeFridgePlanner.v1';

  var LOCS = { fridge: '냉장', freezer: '냉동', pantry: '실온·양념' };
  var CATS = {
    grocery: { label: '장보기', ico: '🛒' },
    dining: { label: '외식', ico: '🍚' },
    delivery: { label: '배달·카페', ico: '☕' },
    etc: { label: '기타', ico: '🧾' }
  };
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* ───────── helpers ───────── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayISO() { return iso(new Date()); }
  function dayDiff(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function money(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function $ (id) { return document.getElementById(id); }

  /* ───────── state ───────── */
  function blank() {
    return { v: 1, items: [], meals: {}, expenses: [], budget: {} };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      return {
        v: 1,
        items: Array.isArray(d.items) ? d.items : [],
        meals: d.meals && typeof d.meals === 'object' ? d.meals : {},
        expenses: Array.isArray(d.expenses) ? d.expenses : [],
        budget: d.budget && typeof d.budget === 'object' ? d.budget : {}
      };
    } catch (e) { return blank(); }
  }
  var state = load();

  var saveTimer = null;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('저장 공간이 부족해요. 데이터를 내보낸 뒤 정리해 주세요.'); }
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }

  /* ───────── ui state ───────── */
  var ui = {
    tab: 'fridge',
    loc: 'all',
    status: 'all',
    sortName: false,
    weekStart: startOfWeek(new Date()),
    month: monthKey(new Date()),
    editingExp: null,
    activeMeal: null
  };

  /* ───────── toast ───────── */
  var toastEl = $('toast');
  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    toastEl.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = msg;
    toastEl.appendChild(span);
    if (opts.undo) {
      var b = document.createElement('button');
      b.className = 'undo';
      b.type = 'button';
      b.textContent = '되돌리기';
      b.addEventListener('click', function () {
        hideToast();
        opts.undo();
      });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.undo ? 5000 : 2200);
  }
  function hideToast() { toastEl.classList.remove('show'); clearTimeout(toastTimer); }

  /* ───────── sheet ───────── */
  var sheet = $('sheet');
  function openSheet(title, html, mount) {
    $('sheet-title').textContent = title;
    var body = $('sheet-body');
    body.innerHTML = html;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    if (mount) mount(body);
  }
  function closeSheet() {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
  }
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  /* ───────── tabs ───────── */
  var panels = { fridge: $('panel-fridge'), meals: $('panel-meals'), money: $('panel-money') };
  function setTab(name) {
    ui.tab = name;
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== name; });
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'meals') { renderMeals(); renderIngredients(); }
    if (name === 'money') { renderMoney(); }
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.dataset.tab); });
  });

  /* ───────── fridge ───────── */
  function dueInfo(expiry) {
    if (!expiry) return { cls: 'none', text: '기한 없음', d: null };
    var d = dayDiff(expiry, todayISO());
    if (d < 0) return { cls: 'exp', text: '만료 ' + (-d) + '일', d: d };
    if (d === 0) return { cls: 'exp', text: 'D-day', d: 0 };
    if (d <= 3) return { cls: 'soon', text: 'D-' + d, d: d };
    return { cls: 'ok', text: 'D-' + d, d: d };
  }
  function dueText(expiry) {
    if (!expiry) return '';
    var p = parseISO(expiry);
    return (p.getMonth() + 1) + '/' + p.getDate() + '까지';
  }

  function sortedItems() {
    var list = state.items.filter(function (it) {
      if (ui.loc !== 'all' && it.loc !== ui.loc) return false;
      if (ui.status !== 'all') {
        var d = it.expiry ? dayDiff(it.expiry, todayISO()) : null;
        if (ui.status === 'soon' && !(d !== null && d >= 0 && d <= 3)) return false;
        if (ui.status === 'expired' && !(d !== null && d < 0)) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (ui.sortName) return (a.name || '').localeCompare(b.name || '', 'ko');
      var da = a.expiry ? dayDiff(a.expiry, todayISO()) : null;
      var db = b.expiry ? dayDiff(b.expiry, todayISO()) : null;
      if (da === null && db === null) return (a.name || '').localeCompare(b.name || '', 'ko');
      if (da === null) return 1;
      if (db === null) return -1;
      if (da !== db) return da - db;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
    return list;
  }

  function renderFridge() {
    var soon = 0, exp = 0;
    state.items.forEach(function (it) {
      if (!it.expiry) return;
      var d = dayDiff(it.expiry, todayISO());
      if (d < 0) exp++; else if (d <= 3) soon++;
    });
    $('fridge-stat').innerHTML =
      '총 <b>' + state.items.length + '</b>개 · ' +
      '<span class="warn">임박 <b class="warn">' + soon + '</b></span> · ' +
      '<span class="danger">만료 <b class="danger">' + exp + '</b></span>';

    var list = sortedItems();
    $('fridge-count').textContent = list.length + '개 품목';

    var el = $('item-list');
    if (!state.items.length) {
      el.innerHTML = '<div class="empty"><span class="em">🧺</span>' +
        '<p>냉장고가 텅 비어 있네요.<br><b>+ 품목</b>을 눌러 하나씩 담아보세요.</p></div>';
      return;
    }
    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="em">🔍</span><p>조건에 맞는 품목이 없어요.</p></div>';
      return;
    }

    el.innerHTML = list.map(function (it) {
      var due = dueInfo(it.expiry);
      var sub = [];
      if (it.qty) sub.push(esc(it.qty));
      if (it.expiry) sub.push('<span class="due ' + due.cls + '">' + dueText(it.expiry) + '</span>');
      return '<div class="item" data-id="' + it.id + '">' +
        '<div class="item-main">' +
          '<div class="item-name"><span class="nm">' + esc(it.name) + '</span>' +
            '<span class="tag ' + it.loc + '">' + (LOCS[it.loc] || '') + '</span></div>' +
          '<div class="item-sub">' + (sub.length ? sub.join(' · ') : '수량·기한 미입력') + '</div>' +
        '</div>' +
        '<div class="item-right">' +
          '<span class="badge ' + due.cls + '">' + due.text + '</span>' +
          '<div class="item-acts">' +
            '<button class="act done" data-act="done" aria-label="소진 완료">✓ 소진</button>' +
            '<button class="act del" data-act="del" aria-label="삭제">🗑</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  $('item-list').addEventListener('click', function (e) {
    var row = e.target.closest('.item');
    if (!row) return;
    var id = row.dataset.id;
    var item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;
    var btn = e.target.closest('[data-act]');
    if (!btn) { openItemSheet(item); return; }
    if (btn.dataset.act === 'done') removeItem(id, true);
    else removeItem(id, false);
  });

  function removeItem(id, consumed) {
    var idx = state.items.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var removed = state.items.splice(idx, 1)[0];
    save();
    renderFridge();
    renderIngredients();
    toast((consumed ? '🧺 ' : '') + removed.name + (consumed ? ' 소진 완료!' : ' 삭제했어요'), {
      undo: function () {
        state.items.splice(Math.min(idx, state.items.length), 0, removed);
        save(); renderFridge(); renderIngredients();
        toast('되돌렸어요');
      }
    });
  }

  $('loc-filter').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    ui.loc = b.dataset.loc;
    $('loc-filter').querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
    renderFridge();
  });
  $('status-filter').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    ui.status = b.dataset.status;
    $('status-filter').querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
    renderFridge();
  });
  $('sort-name').addEventListener('change', function (e) {
    ui.sortName = e.target.checked;
    renderFridge();
  });
  $('add-item').addEventListener('click', function () { openItemSheet(null); });

  function openItemSheet(item) {
    var isEdit = !!item;
    var cur = item || { loc: 'fridge', name: '', qty: '', expiry: '' };
    var segHTML = Object.keys(LOCS).map(function (k) {
      return '<button type="button" data-loc="' + k + '" class="' + (k === cur.loc ? 'on' : '') + '">' + LOCS[k] + '</button>';
    }).join('');
    openSheet(isEdit ? '품목 수정' : '품목 추가',
      '<form class="form" id="item-form" autocomplete="off">' +
        '<label class="field"><span>보관 구분</span><div class="seg" id="loc-seg">' + segHTML + '</div></label>' +
        '<label class="field"><span>품목명</span>' +
          '<input name="name" value="' + esc(cur.name) + '" placeholder="예: 대파" required></label>' +
        '<div class="row2">' +
          '<label class="field"><span>수량</span><input name="qty" value="' + esc(cur.qty) + '" placeholder="예: 1단"></label>' +
          '<label class="field"><span>유통기한</span><input type="date" name="expiry" value="' + (cur.expiry || '') + '"></label>' +
        '</div>' +
        '<div class="row2">' +
          '<button class="btn primary" type="submit">' + (isEdit ? '저장' : '추가') + '</button>' +
          '<button class="btn ghost" type="button" data-close>취소</button>' +
        '</div>' +
      '</form>',
      function (body) {
        var loc = cur.loc;
        body.querySelector('#loc-seg').addEventListener('click', function (e) {
          var b = e.target.closest('button[data-loc]'); if (!b) return;
          loc = b.dataset.loc;
          body.querySelectorAll('#loc-seg button').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
        body.querySelector('#item-form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var f = new FormData(ev.target);
          var name = String(f.get('name') || '').trim();
          if (!name) return;
          var data = {
            loc: loc,
            name: name,
            qty: String(f.get('qty') || '').trim(),
            expiry: String(f.get('expiry') || '')
          };
          if (isEdit) { Object.assign(item, data); toast('수정했어요'); }
          else { state.items.push(Object.assign({ id: uid(), created: Date.now() }, data)); toast('냉장고에 담았어요 🧊'); }
          save();
          closeSheet();
          renderFridge();
          renderIngredients();
        });
        var n = body.querySelector('input[name=name]');
        if (n && !isEdit) setTimeout(function () { try { n.focus(); } catch (e) {} }, 340);
      });
  }

  /* ───────── meals ───────── */
  function weekDates() {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(ui.weekStart, i));
    return out;
  }

  function renderMeals() {
    var days = weekDates();
    var start = days[0], end = days[6];
    var thisWeek = iso(startOfWeek(new Date())) === iso(start);
    $('week-label').innerHTML = start.getFullYear() + '년 ' + (start.getMonth() + 1) + '월 ' + start.getDate() + '일 – ' +
      (end.getMonth() + 1) + '월 ' + end.getDate() + '일' +
      '<small>' + (thisWeek ? '이번 주' : '') + '</small>';

    var today = todayISO();
    $('week-grid').innerHTML = days.map(function (d) {
      var key = iso(d);
      var m = state.meals[key] || {};
      var dow = d.getDay();
      var dowCls = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
      function cell(label, field, ph) {
        return '<div class="meal-row"><span class="meal-tag">' + label + '</span>' +
          '<input class="meal-input' + (field === 'memo' ? ' memo' : '') + '" data-date="' + key + '" data-meal="' + field + '"' +
          ' value="' + esc(m[field] || '') + '" placeholder="' + ph + '" enterkeyhint="done"></div>';
      }
      return '<div class="day' + (key === today ? ' today' : '') + '">' +
        '<div class="day-head"><div class="day-name">' +
          '<span class="dow ' + dowCls + '">' + DOW[dow] + '</span>' +
          '<span class="day-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
          (key === today ? '<span class="day-today">오늘</span>' : '') +
        '</div></div>' +
        cell('아침', 'b', '아침 메뉴') +
        cell('점심', 'l', '점심 메뉴') +
        cell('저녁', 'd', '저녁 메뉴') +
        cell('메모', 'memo', '장보기·준비 메모') +
      '</div>';
    }).join('');
  }

  $('week-grid').addEventListener('input', function (e) {
    var inp = e.target.closest('.meal-input');
    if (!inp) return;
    var key = inp.dataset.date, field = inp.dataset.meal;
    if (!state.meals[key]) state.meals[key] = {};
    state.meals[key][field] = inp.value;
    saveSoon();
  });
  $('week-grid').addEventListener('focusin', function (e) {
    var inp = e.target.closest('.meal-input');
    if (inp) ui.activeMeal = inp;
  });

  function renderIngredients() {
    var soon = [], rest = [];
    state.items.forEach(function (it) {
      var d = it.expiry ? dayDiff(it.expiry, todayISO()) : null;
      if (d !== null && d >= 0 && d <= 3) soon.push({ it: it, d: d });
      else if (d === null || d > 3) rest.push({ it: it, d: d });
    });
    soon.sort(function (a, b) { return a.d - b.d; });
    rest.sort(function (a, b) { return (a.it.name || '').localeCompare(b.it.name || '', 'ko'); });

    function chips(arr, cls) {
      return arr.map(function (o) {
        var suf = o.d === null ? '' : (o.d === 0 ? ' · D-day' : ' · D-' + o.d);
        return '<button type="button" class="chip ing ' + cls + '" data-name="' + esc(o.it.name) + '">' +
          esc(o.it.name) + suf + '</button>';
      }).join('') || '<span class="hint">없어요</span>';
    }
    $('ing-soon').innerHTML = chips(soon, 'soon');
    $('ing-rest').innerHTML = chips(rest, '');
  }

  document.querySelectorAll('#ing-soon,#ing-rest').forEach(function (wrap) {
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.chip.ing');
      if (!b) return;
      var name = b.dataset.name;
      var target = ui.activeMeal;
      if (target && document.contains(target)) {
        var cur = target.value.trim();
        target.value = cur ? cur + ', ' + name : name;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
        toast(name + ' 넣었어요');
      } else {
        copyText(name);
        toast(name + ' 복사했어요 · 식단 칸을 눌러 붙여넣으세요');
      }
    });
  });

  function copyText(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t);
      else {
        var ta = document.createElement('textarea');
        ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      }
    } catch (e) {}
  }

  $('toggle-ing').addEventListener('click', function (e) {
    var body = $('ing-body');
    var hidden = body.hidden;
    body.hidden = !hidden;
    e.target.textContent = hidden ? '접기' : '펼치기';
  });

  $('week-prev').addEventListener('click', function () {
    ui.weekStart = addDays(ui.weekStart, -7);
    renderMeals();
  });
  $('week-next').addEventListener('click', function () {
    ui.weekStart = addDays(ui.weekStart, 7);
    renderMeals();
  });

  /* ───────── money ───────── */
  function monthExpenses(mk) {
    return state.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === mk; });
  }
  function renderMonthLabel() {
    var p = ui.month.split('-').map(Number);
    var cur = ui.month === monthKey(new Date());
    $('month-label').innerHTML = p[0] + '년 ' + p[1] + '월' + '<small>' + (cur ? '이번 달' : '') + '</small>';
  }

  function renderMoney() {
    renderMonthLabel();
    var list = monthExpenses(ui.month);
    var sum = { total: 0, grocery: 0, dining: 0, delivery: 0, etc: 0 };
    list.forEach(function (e) {
      var a = Number(e.amount) || 0;
      sum.total += a;
      if (sum[e.cat] === undefined) sum.etc += a; else sum[e.cat] += a;
    });

    var bars = Object.keys(CATS).map(function (k) {
      var v = sum[k] || 0;
      var pct = sum.total ? Math.round((v / sum.total) * 100) : 0;
      return '<div class="catbar">' +
        '<div class="cl">' + CATS[k].ico + ' ' + CATS[k].label + '</div>' +
        '<div class="cv">' + money(v) + '원<small>' + pct + '%</small></div>' +
        '<div class="track"><div class="fill ' + k + '" style="width:' + (sum.total ? Math.max(pct, v ? 2 : 0) : 0) + '%"></div></div>' +
      '</div>';
    }).join('');

    var budget = Number(state.budget[ui.month] || 0);
    var budgetHTML;
    if (budget > 0) {
      var pct2 = Math.round((sum.total / budget) * 100);
      var left = budget - sum.total;
      var cls = pct2 >= 100 ? 'over' : (pct2 >= 80 ? 'warn' : '');
      budgetHTML = '<div class="budget">' +
        '<div class="budget-top"><span class="bl">월 예산 ' + money(budget) + '원</span>' +
          '<span class="bv ' + (left < 0 ? 'over' : '') + '">' + (left >= 0 ? '남은 ' + money(left) + '원' : '초과 ' + money(-left) + '원') + '</span></div>' +
        '<div class="budget-track"><div class="budget-fill ' + cls + '" style="width:' + Math.min(pct2, 100) + '%"></div></div>' +
        '<p class="budget-note"><span>' + pct2 + '% 사용</span><button class="mini-link" data-budget-edit>예산 변경</button></p>' +
      '</div>';
    } else {
      budgetHTML = '<div class="budget-empty"><p>월 예산을 정하면 남은 금액과 진행률을 볼 수 있어요.</p>' +
        '<button class="btn ghost small" data-budget-edit>예산 설정</button></div>';
    }

    $('money-summary').innerHTML =
      '<div class="sum-total"><span class="lb">총 식비</span>' +
        '<span class="amt">' + money(sum.total) + '<small>원</small></span></div>' +
      '<div class="catbars">' + bars + '</div>' + budgetHTML;

    // 목록 (날짜 내림차순)
    var el = $('exp-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="em">🧾</span><p>이 달에 기록한 식비가 없어요.<br>위에서 <b>한 줄</b>만 적어보세요.</p></div>';
      return;
    }
    var sorted = list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.created || 0) - (a.created || 0);
    });
    var html = '', lastDate = '';
    sorted.forEach(function (e) {
      if (e.date !== lastDate) {
        lastDate = e.date;
        var d = parseISO(e.date);
        var daySum = sorted.filter(function (x) { return x.date === e.date; })
          .reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
        html += '<div class="day-sep"><span>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DOW[d.getDay()] + ')</span>' +
          '<span class="dsum">' + money(daySum) + '원</span></div>';
      }
      var c = CATS[e.cat] || CATS.etc;
      html += '<div class="exp" data-id="' + e.id + '">' +
        '<div class="exp-ico ' + (CATS[e.cat] ? e.cat : 'etc') + '">' + c.ico + '</div>' +
        '<div class="exp-main"><div class="exp-title">' + esc(e.memo || c.label) + '</div>' +
          '<div class="exp-sub">' + c.label + '</div></div>' +
        '<div class="exp-amt">' + money(e.amount) + '원</div>' +
        '<div class="exp-acts">' +
          '<button class="act" data-act="edit" aria-label="수정">✏️</button>' +
          '<button class="act del" data-act="del" aria-label="삭제">✕</button>' +
        '</div></div>';
    });
    el.innerHTML = html;
  }

  $('exp-list').addEventListener('click', function (e) {
    var row = e.target.closest('.exp'); if (!row) return;
    var id = row.dataset.id;
    var exp = state.expenses.find(function (x) { return x.id === id; });
    if (!exp) return;
    var btn = e.target.closest('[data-act]');
    if (!btn) { startEditExpense(exp); return; }
    if (btn.dataset.act === 'edit') startEditExpense(exp);
    else {
      var idx = state.expenses.findIndex(function (x) { return x.id === id; });
      var removed = state.expenses.splice(idx, 1)[0];
      save(); renderMoney();
      toast('삭제했어요', {
        undo: function () {
          state.expenses.splice(Math.min(idx, state.expenses.length), 0, removed);
          save(); renderMoney(); toast('되돌렸어요');
        }
      });
    }
  });

  function resetExpForm() {
    var f = $('exp-form');
    f.reset();
    f.date.value = (ui.month === monthKey(new Date())) ? todayISO() : ui.month + '-01';
    ui.editingExp = null;
    $('exp-form-title').textContent = '식비 기록하기';
    $('exp-submit').textContent = '추가';
    $('exp-cancel').hidden = true;
    $('exp-edit-hint').hidden = true;
  }

  function startEditExpense(exp) {
    var f = $('exp-form');
    f.date.value = exp.date;
    f.cat.value = exp.cat;
    f.amount.value = exp.amount;
    f.memo.value = exp.memo || '';
    ui.editingExp = exp.id;
    $('exp-form-title').textContent = '식비 수정하기';
    $('exp-submit').textContent = '수정';
    $('exp-cancel').hidden = false;
    $('exp-edit-hint').hidden = false;
    $('panel-money').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { try { f.amount.focus(); } catch (e) {} }, 260);
  }

  $('exp-cancel').addEventListener('click', resetExpForm);

  $('exp-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var date = f.date.value || todayISO();
    var cat = f.cat.value;
    var amount = Math.round(Number(f.amount.value) || 0);
    var memo = (f.memo.value || '').trim();
    if (!date) { toast('날짜를 선택해 주세요'); return; }
    if (amount <= 0) { toast('금액을 입력해 주세요'); f.amount.focus(); return; }

    if (ui.editingExp) {
      var target = state.expenses.find(function (x) { return x.id === ui.editingExp; });
      if (target) { target.date = date; target.cat = cat; target.amount = amount; target.memo = memo; }
      toast('수정했어요');
    } else {
      state.expenses.push({ id: uid(), date: date, cat: cat, amount: amount, memo: memo, created: Date.now() });
      toast(money(amount) + '원 기록했어요');
    }
    save();
    ui.month = date.slice(0, 7);
    resetExpForm();
    renderMoney();
  });

  $('money-summary').addEventListener('click', function (e) {
    if (!e.target.closest('[data-budget-edit]')) return;
    var cur = Number(state.budget[ui.month] || 0);
    openSheet('월 예산 설정',
      '<form class="form" id="budget-form">' +
        '<label class="field"><span>' + ui.month.replace('-', '년 ') + '월 식비 예산(원)</span>' +
          '<input type="number" name="budget" inputmode="numeric" min="0" step="10000" placeholder="예: 400000" value="' + (cur || relateMonthBudget() || '') + '"></label>' +
        '<p class="hint">예산을 0으로 두면 예산 표시를 끕니다.</p>' +
        '<div class="row2"><button class="btn primary" type="submit">저장</button>' +
        '<button class="btn ghost" type="button" data-close>취소</button></div>' +
      '</form>',
      function (body) {
        body.querySelector('#budget-form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var v = Math.round(Number(new FormData(ev.target).get('budget')) || 0);
          if (v > 0) state.budget[ui.month] = v; else delete state.budget[ui.month];
          save(); closeSheet(); renderMoney();
          toast(v > 0 ? '월 예산을 ' + money(v) + '원으로 정했어요' : '예산 설정을 껐어요');
        });
      });
  });

  function relateMonthBudget() {
    // 직전 달에 정한 예산이 있으면 참고값으로 보여줌
    var keys = Object.keys(state.budget).sort();
    var prev = keys.filter(function (k) { return k < ui.month; }).pop();
    return prev ? state.budget[prev] : 0;
  }

  $('month-prev').addEventListener('click', function () {
    var p = ui.month.split('-').map(Number);
    ui.month = monthKey(new Date(p[0], p[1] - 2, 1));
    resetExpForm(); renderMoney();
  });
  $('month-next').addEventListener('click', function () {
    var p = ui.month.split('-').map(Number);
    ui.month = monthKey(new Date(p[0], p[1], 1));
    resetExpForm(); renderMoney();
  });

  /* ───────── data ───────── */
  $('open-data').addEventListener('click', function () {
    openSheet('데이터 관리',
      '<div class="card" style="box-shadow:none;margin-bottom:12px">' +
        '<p class="hint" style="margin-bottom:10px">냉장고·식단·식비 기록은 <b>이 브라우저(이 기기)에만</b> 저장됩니다. 서버로 보내지 않아요.</p>' +
        '<p class="hint" style="margin:0">기기를 바꾸거나 기록을 지우기 전에 JSON으로 내보내 두세요.</p>' +
      '</div>' +
      '<div class="form">' +
        '<button class="btn primary" type="button" id="do-export">JSON으로 내보내기</button>' +
        '<label class="btn ghost" for="do-import" style="cursor:pointer">JSON 불러오기</label>' +
        '<input type="file" id="do-import" accept="application/json,.json" hidden>' +
        '<button class="btn danger" type="button" id="do-reset">모든 데이터 초기화</button>' +
      '</div>',
      function (body) {
        body.querySelector('#do-export').addEventListener('click', exportJSON);
        body.querySelector('#do-import').addEventListener('change', importJSON);
        body.querySelector('#do-reset').addEventListener('click', function () {
          var ok = window.confirm('냉장고 품목, 식단표, 식비 기록이 모두 지워집니다.\n정말 초기화할까요?');
          if (!ok) return;
          state = blank();
          save();
          closeSheet();
          ui.editingExp = null;
          ui.activeMeal = null;
          resetExpForm();
          renderFridge(); renderMeals(); renderIngredients(); renderMoney();
          toast('모두 초기화했어요');
        });
      });
  });

  function exportJSON() {
    var data = JSON.stringify({
      app: 'home-fridge-planner',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: state.items,
      meals: state.meals,
      expenses: state.expenses,
      budget: state.budget
    }, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fridge-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('JSON 파일을 내보냈어요');
  }

  function importJSON(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var d;
      try { d = JSON.parse(String(reader.result)); }
      catch (err) { toast('JSON 파일을 읽을 수 없어요'); e.target.value = ''; return; }
      if (!d || !Array.isArray(d.items) || !Array.isArray(d.expenses) || typeof d.meals !== 'object') {
        toast('이 앱의 백업 파일이 아니에요'); e.target.value = ''; return;
      }
      var ok = window.confirm('지금 기록을 백업 파일 내용으로 바꿀까요?\n(현재 데이터는 덮어쓰여요)');
      if (!ok) { e.target.value = ''; return; }
      state = {
        v: 1,
        items: d.items, meals: d.meals || {}, expenses: d.expenses,
        budget: (d.budget && typeof d.budget === 'object') ? d.budget : {}
      };
      save();
      closeSheet();
      resetExpForm();
      renderFridge(); renderMeals(); renderIngredients(); renderMoney();
      toast('백업을 불러왔어요 (' + state.items.length + '개 품목)');
      e.target.value = '';
    };
    reader.onerror = function () { toast('파일을 읽지 못했어요'); };
    reader.readAsText(file);
  }

  /* ───────── init ───────── */
  function renderHead() {
    var d = new Date();
    $('head-date').textContent = d.getMonth() + 1 + '월 ' + d.getDate() + '일 ' + DOW[d.getDay()] + '요일';
  }

  renderHead();
  renderFridge();
  renderIngredients();
  renderMeals();
  resetExpForm();
  renderMoney();
  setTab('fridge');
})();
