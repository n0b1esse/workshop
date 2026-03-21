/**
 * Посредник по швейному производству — логика SPA, графики, localStorage
 */

(function () {
  "use strict";

  const STORAGE_KEY = "garment-broker-spa-v1";

  /** Подписи статусов на русском (значения в данных — на англ., для совместимости) */
  const STATUS_LABELS = {
    Negotiation: "Переговоры",
    Materials: "Материалы",
    Cutting: "Раскрой",
    Sewing: "Пошив",
    QC: "ОТК",
    Finished: "Готово",
  };

  /** @typedef {'Negotiation'|'Materials'|'Cutting'|'Sewing'|'QC'|'Finished'} OrderStatus */

  /**
   * @typedef {Object} Order
   * @property {string} id
   * @property {string} orderName
   * @property {string} clientName
   * @property {number} clientBudget
   * @property {string} factoryName
   * @property {number} quantity
   * @property {number} factoryPricePerUnit
   * @property {number} materialCosts
   * @property {number} additionalExpenses
   * @property {number} progressPercent
   * @property {OrderStatus} status
   * @property {number} createdAt
   */

  /** @type {Order[]} */
  let orders = [];

  /** @type {Record<string, Chart>} */
  const charts = {};

  const STATUS_STYLES = {
    Negotiation: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    Materials: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
    Cutting: "bg-sky-50 text-sky-800 ring-1 ring-sky-200/80",
    Sewing: "bg-orange-50 text-orange-800 ring-1 ring-orange-200/80",
    QC: "bg-violet-50 text-violet-800 ring-1 ring-violet-200/80",
    Finished: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80",
  };

  const els = {
    body: document.getElementById("orders-body"),
    cards: document.getElementById("orders-cards"),
    empty: document.getElementById("empty-state"),
    count: document.getElementById("order-count"),
    kpiRevenue: document.getElementById("kpi-revenue"),
    kpiCosts: document.getElementById("kpi-costs"),
    kpiProfit: document.getElementById("kpi-profit"),
    kpiMargin: document.getElementById("kpi-margin"),
    sync: document.getElementById("sync-label"),
    backdrop: document.getElementById("modal-backdrop"),
    panel: document.getElementById("modal-panel"),
    form: document.getElementById("order-form"),
    title: document.getElementById("modal-title"),
    editId: document.getElementById("edit-id"),
    submit: document.getElementById("form-submit"),
    err: document.getElementById("form-error"),
    progress: document.getElementById("progress"),
    progressLabel: document.getElementById("progress-label"),
  };

  /** @param {Order} o */
  function metrics(o) {
    const revenue = o.clientBudget;
    const factoryTotal = o.quantity * o.factoryPricePerUnit;
    const totalCosts = factoryTotal + o.materialCosts + o.additionalExpenses;
    const grossProfit = revenue - totalCosts;
    const netMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const markupPct = totalCosts > 0 ? (grossProfit / totalCosts) * 100 : 0;
    return {
      revenue,
      factoryTotal,
      totalCosts,
      grossProfit,
      netMarginPct,
      markupPct,
    };
  }

  function formatMoney(n) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
  }

  function formatPct(n) {
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
  }

  /** Склонение: «N заказов» */
  function formatOrderCount(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return n + " заказ";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return n + " заказа";
    return n + " заказов";
  }

  /** @param {string} key */
  function statusLabel(key) {
    return STATUS_LABELS[/** @type {keyof typeof STATUS_LABELS} */ (key)] || key;
  }

  /** Net margin color classes for table */
  function marginClass(m) {
    if (m < 0) return "text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-md";
    if (m > 20) return "text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md";
    if (m < 10) return "text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-md";
    return "text-slate-700 font-medium bg-slate-100 px-2 py-0.5 rounded-md";
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) orders = p;
      }
    } catch (e) {
      console.warn("Load failed", e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      if (els.sync) {
        els.sync.textContent = "Сохранено";
        els.sync.className = "text-emerald-400/90";
      }
    } catch (e) {
      if (els.sync) {
        els.sync.textContent = "Ошибка";
        els.sync.className = "text-amber-400";
      }
    }
  }

  function refreshIcons() {
    if (typeof lucide !== "undefined" && lucide.createIcons) {
      lucide.createIcons();
    }
  }

  function updateKpis() {
    let sumRev = 0;
    let sumCost = 0;
    let sumProfit = 0;
    orders.forEach((o) => {
      const m = metrics(o);
      sumRev += m.revenue;
      sumCost += m.totalCosts;
      sumProfit += m.grossProfit;
    });
    const blendedMargin = sumRev > 0 ? (sumProfit / sumRev) * 100 : 0;

    els.kpiRevenue.textContent = formatMoney(sumRev);
    els.kpiCosts.textContent = formatMoney(sumCost);
    els.kpiProfit.textContent = formatMoney(sumProfit);
    els.kpiProfit.className =
      "mt-2 text-lg font-bold tabular-nums sm:mt-3 sm:text-2xl lg:text-3xl " +
      (sumProfit >= 0 ? "text-emerald-600" : "text-red-600");
    els.kpiMargin.textContent = formatPct(blendedMargin);
    els.kpiMargin.className =
      "mt-2 text-lg font-bold tabular-nums sm:mt-3 sm:text-2xl lg:text-3xl " +
      (blendedMargin >= 0 ? "text-violet-700" : "text-red-600");

    const n = orders.length;
    els.count.textContent = formatOrderCount(n);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  /** @param {Order} o */
  function renderPie(o) {
    const id = o.id;
    const mobOpen = document.getElementById("ex-mob-" + id)?.classList.contains("is-open");
    const canvas = mobOpen
      ? document.getElementById("chart-mob-" + id)
      : document.getElementById("chart-" + id);
    if (!canvas || typeof Chart === "undefined") return;

    destroyChart(id);
    const m = metrics(o);
    const mat = Math.max(0, o.materialCosts);
    const fac = Math.max(0, m.factoryTotal);
    const prof = m.grossProfit;

    const note = canvas.closest(".chart-box")?.querySelector(".chart-note");
    if (note) {
      if (prof < 0) {
        note.textContent = "Отрицательная прибыль — затраты выше бюджета клиента.";
        note.classList.remove("hidden");
      } else {
        note.textContent = "";
        note.classList.add("hidden");
      }
    }

    const profitSlice = Math.max(0, prof);
    const data = [mat, fac, profitSlice];
    const labels = ["Материалы", "Цех", "Прибыль"];

    charts[id] = new Chart(canvas, {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: ["rgb(245 158 11)", "rgb(71 85 105)", "rgb(16 185 129)"],
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 12,
              padding: 10,
              font: { size: 11, family: "Inter, system-ui, sans-serif" },
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                const i = ctx.dataIndex;
                if (i === 2 && m.grossProfit < 0) {
                  return "Прибыль: " + formatMoney(m.grossProfit);
                }
                return (ctx.label || "") + ": " + formatMoney(typeof v === "number" ? v : 0);
              },
            },
          },
          title: {
            display: true,
            text: "Структура затрат",
            font: { size: 12, weight: "600" },
            color: "#64748b",
            padding: { bottom: 8 },
          },
        },
      },
    });
  }

  function renderTable() {
    els.body.innerHTML = "";
    if (els.cards) els.cards.innerHTML = "";
    if (orders.length === 0) {
      els.empty.classList.remove("hidden");
      refreshIcons();
      return;
    }
    els.empty.classList.add("hidden");

    const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

    sorted.forEach((o) => {
      const m = metrics(o);
      const pct = Math.min(100, Math.max(0, o.progressPercent));
      const stClass = STATUS_STYLES[o.status] || STATUS_STYLES.Negotiation;
      const marginCls = marginClass(m.netMarginPct);
      const stText = statusLabel(o.status);

      const tr = document.createElement("tr");
      tr.className = "order-row border-slate-100";
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 align-top">
          <button type="button" class="expand-btn text-left font-medium text-slate-900 hover:text-indigo-700 flex items-start gap-2 group" data-id="${o.id}" aria-expanded="false">
            <i data-lucide="chevron-right" class="h-4 w-4 mt-0.5 text-slate-400 transition-transform duration-300 shrink-0 icon-chevron" aria-hidden="true"></i>
            <span>
              <span class="block">${escapeHtml(o.orderName)}</span>
              <span class="text-xs font-normal text-slate-500">${escapeHtml(o.clientName)}</span>
            </span>
          </button>
        </td>
        <td class="px-4 py-3 text-slate-600 align-top">${escapeHtml(o.factoryName)}</td>
        <td class="px-4 py-3 tabular-nums font-medium text-slate-800 align-top">${formatMoney(m.revenue)}</td>
        <td class="px-4 py-3 tabular-nums text-slate-600 align-top">${formatMoney(m.totalCosts)}</td>
        <td class="px-4 py-3 tabular-nums font-semibold align-top ${m.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.grossProfit)}</td>
        <td class="px-4 py-3 align-top"><span class="inline-block text-sm tabular-nums ${marginCls}">${formatPct(m.netMarginPct)}</span></td>
        <td class="px-4 py-3 align-top">
          <div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="text-[10px] text-slate-400 mt-1 block tabular-nums">${pct}% · ${escapeHtml(stText)}</span>
        </td>
        <td class="px-4 py-3 align-top">
          <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${stClass}">${escapeHtml(stText)}</span>
        </td>
        <td class="px-4 py-3 text-right align-top whitespace-nowrap space-x-1">
          <button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50" data-act="edit" data-id="${o.id}">
            <i data-lucide="pencil" class="h-3.5 w-3.5" aria-hidden="true"></i> Изменить
          </button>
          <button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50" data-act="del" data-id="${o.id}">
            <i data-lucide="trash-2" class="h-3.5 w-3.5" aria-hidden="true"></i> Удалить
          </button>
        </td>
      `;

      const trExp = document.createElement("tr");
      trExp.className = "bg-slate-50/80";
      trExp.innerHTML = `
        <td colspan="9" class="p-0 border-0">
          <div class="order-expand" id="ex-${o.id}">
            <div class="order-expand-inner">
              <div class="px-4 sm:px-6 py-6 border-t border-slate-100 grid lg:grid-cols-2 gap-8 items-start">
                <div class="text-sm space-y-3">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Финансы по заказу</p>
                  <dl class="grid grid-cols-2 gap-x-4 gap-y-2 max-w-md">
                    <dt class="text-slate-500">Выручка (клиент)</dt><dd class="text-right tabular-nums font-medium">${formatMoney(m.revenue)}</dd>
                    <dt class="text-slate-500">Цех (кол-во × цена)</dt><dd class="text-right tabular-nums">${formatMoney(m.factoryTotal)}</dd>
                    <dt class="text-slate-500">Материалы</dt><dd class="text-right tabular-nums">${formatMoney(o.materialCosts)}</dd>
                    <dt class="text-slate-500">Доп. расходы</dt><dd class="text-right tabular-nums">${formatMoney(o.additionalExpenses)}</dd>
                    <dt class="text-slate-500">Затраты всего</dt><dd class="text-right tabular-nums font-medium">${formatMoney(m.totalCosts)}</dd>
                    <dt class="text-slate-500">Валовая прибыль</dt><dd class="text-right tabular-nums font-semibold ${m.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.grossProfit)}</dd>
                    <dt class="text-slate-500">Чистая маржа</dt><dd class="text-right tabular-nums"><span class="inline-block text-sm ${marginCls}">${formatPct(m.netMarginPct)}</span></dd>
                    <dt class="text-slate-500">Наценка</dt><dd class="text-right tabular-nums text-slate-700">${formatPct(m.markupPct)}</dd>
                  </dl>
                </div>
                <div class="chart-box">
                  <canvas id="chart-${o.id}" height="220" aria-label="Диаграмма структуры затрат"></canvas>
                  <p class="chart-note hidden text-xs text-center text-red-600 mt-2"></p>
                </div>
              </div>
            </div>
          </div>
        </td>
      `;

      els.body.appendChild(tr);
      els.body.appendChild(trExp);

      if (els.cards) {
        const card = document.createElement("div");
        card.className =
          "order-card-mob rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-4";
        card.innerHTML = `
          <button type="button" class="expand-btn flex w-full items-start gap-2 text-left" data-id="${o.id}" aria-expanded="false">
            <i data-lucide="chevron-right" class="icon-chevron mt-0.5 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300" aria-hidden="true"></i>
            <span class="min-w-0 flex-1">
              <span class="block font-semibold text-slate-900">${escapeHtml(o.orderName)}</span>
              <span class="mt-0.5 block text-xs text-slate-500">${escapeHtml(o.clientName)} · ${escapeHtml(o.factoryName)}</span>
            </span>
          </button>
          <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-[10px] uppercase tracking-wide text-slate-400">Выручка</p>
              <p class="mt-0.5 font-semibold tabular-nums text-slate-900">${formatMoney(m.revenue)}</p>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-wide text-slate-400">Затраты</p>
              <p class="mt-0.5 font-medium tabular-nums text-slate-700">${formatMoney(m.totalCosts)}</p>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-wide text-slate-400">Прибыль</p>
              <p class="mt-0.5 font-semibold tabular-nums ${m.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.grossProfit)}</p>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-wide text-slate-400">Маржа</p>
              <p class="mt-0.5"><span class="inline-block text-sm tabular-nums ${marginCls}">${formatPct(m.netMarginPct)}</span></p>
            </div>
          </div>
          <div class="mt-3">
            <div class="progress-track h-2" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            <p class="mt-1 text-[11px] text-slate-400 tabular-nums">${pct}% · ${escapeHtml(stText)}</p>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${stClass}">${escapeHtml(stText)}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-2 text-sm font-medium text-indigo-700 active:bg-indigo-100" data-act="edit" data-id="${o.id}">
              <i data-lucide="pencil" class="h-4 w-4" aria-hidden="true"></i> Изменить
            </button>
            <button type="button" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-2 text-sm font-medium text-red-700 active:bg-red-100" data-act="del" data-id="${o.id}">
              <i data-lucide="trash-2" class="h-4 w-4" aria-hidden="true"></i> Удалить
            </button>
          </div>
          <div class="order-expand mt-3" id="ex-mob-${o.id}">
            <div class="order-expand-inner">
              <div class="rounded-xl border border-slate-100 bg-slate-50/90 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Финансы по заказу</p>
                <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <dt class="text-slate-500">Выручка (клиент)</dt><dd class="text-right tabular-nums font-medium">${formatMoney(m.revenue)}</dd>
                  <dt class="text-slate-500">Цех (кол-во × цена)</dt><dd class="text-right tabular-nums">${formatMoney(m.factoryTotal)}</dd>
                  <dt class="text-slate-500">Материалы</dt><dd class="text-right tabular-nums">${formatMoney(o.materialCosts)}</dd>
                  <dt class="text-slate-500">Доп. расходы</dt><dd class="text-right tabular-nums">${formatMoney(o.additionalExpenses)}</dd>
                  <dt class="text-slate-500">Затраты всего</dt><dd class="text-right tabular-nums font-medium">${formatMoney(m.totalCosts)}</dd>
                  <dt class="text-slate-500">Валовая прибыль</dt><dd class="text-right tabular-nums font-semibold ${m.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.grossProfit)}</dd>
                  <dt class="text-slate-500">Чистая маржа</dt><dd class="text-right"><span class="inline-block text-sm ${marginCls}">${formatPct(m.netMarginPct)}</span></dd>
                  <dt class="text-slate-500">Наценка</dt><dd class="text-right tabular-nums text-slate-700">${formatPct(m.markupPct)}</dd>
                </dl>
                <div class="chart-box mt-4 w-full">
                  <canvas id="chart-mob-${o.id}" height="200" aria-label="Диаграмма структуры затрат"></canvas>
                  <p class="chart-note mt-2 hidden text-center text-xs text-red-600"></p>
                </div>
              </div>
            </div>
          </div>
        `;
        els.cards.appendChild(card);
      }
    });

    bindRows();
    refreshIcons();
  }

  function bindRows() {
    document.querySelectorAll(".expand-btn").forEach((btn) => {
      btn.addEventListener("click", onExpand);
    });
    document.querySelectorAll("[data-act='edit']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openEdit(b.getAttribute("data-id"));
      });
    });
    document.querySelectorAll("[data-act='del']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        removeOrder(b.getAttribute("data-id"));
      });
    });
  }

  /** @param {Event} e */
  function onExpand(e) {
    const btn = e.currentTarget;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const inCards = Boolean(btn.closest("#orders-cards"));
    const wrap = inCards ? document.getElementById("ex-mob-" + id) : document.getElementById("ex-" + id);
    if (!wrap) return;
    const chev = btn.querySelector(".icon-chevron");
    const open = wrap.classList.contains("is-open");

    if (open) {
      wrap.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      if (chev) chev.style.transform = "rotate(0deg)";
      destroyChart(id);
    } else {
      wrap.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      if (chev) chev.style.transform = "rotate(90deg)";
      const order = orders.find((x) => x.id === id);
      if (order) requestAnimationFrame(() => renderPie(order));
    }
  }

  function openModal(isEdit) {
    closeSidebarUi();
    els.backdrop.classList.add("is-open");
    els.backdrop.setAttribute("aria-hidden", "false");
    els.panel.classList.add("is-open");
    els.panel.classList.remove("scale-95", "opacity-0", "pointer-events-none");
    els.panel.classList.add("scale-100", "opacity-100", "pointer-events-auto");
    els.title.textContent = isEdit ? "Редактировать заказ" : "Новый заказ";
    els.submit.textContent = isEdit ? "Обновить" : "Сохранить";
    document.body.classList.add("sidebar-lock");
    refreshIcons();
  }

  function closeModal() {
    els.backdrop.classList.remove("is-open");
    els.backdrop.setAttribute("aria-hidden", "true");
    els.panel.classList.remove("is-open", "scale-100", "opacity-100", "pointer-events-auto");
    els.panel.classList.add("scale-95", "opacity-0", "pointer-events-none");
    document.body.classList.remove("sidebar-lock");
    hideErr();
  }

  function closeSidebarUi() {
    const sidebar = document.getElementById("sidebar");
    const sbBackdrop = document.getElementById("sidebar-backdrop");
    const menuBtn = document.getElementById("btn-menu");
    if (sidebar) sidebar.classList.remove("is-open");
    if (sbBackdrop) {
      sbBackdrop.classList.remove("is-open");
      sbBackdrop.setAttribute("aria-hidden", "true");
    }
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    if (window.innerWidth < 1024) document.body.classList.remove("sidebar-lock");
  }

  function openSidebarUi() {
    const sidebar = document.getElementById("sidebar");
    const sbBackdrop = document.getElementById("sidebar-backdrop");
    const menuBtn = document.getElementById("btn-menu");
    if (sidebar) sidebar.classList.add("is-open");
    if (sbBackdrop) {
      sbBackdrop.classList.add("is-open");
      sbBackdrop.setAttribute("aria-hidden", "false");
    }
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
    if (window.innerWidth < 1024) document.body.classList.add("sidebar-lock");
  }

  function toggleSidebarUi() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.classList.contains("is-open")) closeSidebarUi();
    else openSidebarUi();
  }

  function hideErr() {
    els.err.classList.add("hidden");
    els.err.textContent = "";
  }

  function showErr(msg) {
    els.err.textContent = msg;
    els.err.classList.remove("hidden");
  }

  function openNew() {
    els.form.reset();
    els.editId.value = "";
    els.progress.value = "0";
    els.progressLabel.textContent = "0%";
    openModal(false);
  }

  /** @param {string|null} id */
  function openEdit(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    els.editId.value = o.id;
    document.getElementById("order-name").value = o.orderName;
    document.getElementById("client-name").value = o.clientName;
    document.getElementById("client-budget").value = String(o.clientBudget);
    document.getElementById("factory-name").value = o.factoryName;
    document.getElementById("quantity").value = String(o.quantity);
    document.getElementById("factory-price").value = String(o.factoryPricePerUnit);
    document.getElementById("material-costs").value = String(o.materialCosts);
    document.getElementById("extra-expenses").value = String(o.additionalExpenses);
    document.getElementById("progress").value = String(o.progressPercent);
    document.getElementById("status").value = o.status;
    els.progressLabel.textContent = o.progressPercent + "%";
    openModal(true);
  }

  /** @param {string|null} id */
  function removeOrder(id) {
    if (!id || !confirm("Удалить этот заказ?")) return;
    destroyChart(id);
    orders = orders.filter((o) => o.id !== id);
    save();
    updateKpis();
    renderTable();
  }

  /** @param {Event} e */
  function onSubmit(e) {
    e.preventDefault();
    hideErr();

    const orderName = document.getElementById("order-name").value.trim();
    const clientName = document.getElementById("client-name").value.trim();
    const clientBudget = parseFloat(document.getElementById("client-budget").value);
    const factoryName = document.getElementById("factory-name").value.trim();
    const quantity = parseInt(document.getElementById("quantity").value, 10);
    const factoryPrice = parseFloat(document.getElementById("factory-price").value);
    const materialCosts = parseFloat(document.getElementById("material-costs").value);
    const extra = parseFloat(document.getElementById("extra-expenses").value);
    const progressPercent = parseInt(els.progress.value, 10);
    /** @type {OrderStatus} */
    const status = document.getElementById("status").value;
    const edit = els.editId.value.trim();

    if (!orderName || !clientName) {
      showErr("Укажите название заказа и клиента.");
      return;
    }
    if (Number.isNaN(clientBudget) || clientBudget < 0) {
      showErr("Бюджет клиента должен быть неотрицательным числом.");
      return;
    }
    if (!factoryName) {
      showErr("Укажите название цеха или фабрики.");
      return;
    }
    if (Number.isNaN(quantity) || quantity < 1) {
      showErr("Количество не меньше 1.");
      return;
    }
    if (Number.isNaN(factoryPrice) || factoryPrice < 0) {
      showErr("Укажите корректную цену цеха за единицу.");
      return;
    }
    if (Number.isNaN(materialCosts) || materialCosts < 0 || Number.isNaN(extra) || extra < 0) {
      showErr("Материалы и доп. расходы — неотрицательные числа.");
      return;
    }

    const payload = {
      orderName,
      clientName,
      clientBudget,
      factoryName,
      quantity,
      factoryPricePerUnit: factoryPrice,
      materialCosts,
      additionalExpenses: extra,
      progressPercent: Math.min(100, Math.max(0, Number.isNaN(progressPercent) ? 0 : progressPercent)),
      status,
    };

    if (edit) {
      const i = orders.findIndex((x) => x.id === edit);
      if (i === -1) return;
      orders[i] = { ...orders[i], ...payload };
    } else {
      orders.push({
        id: crypto.randomUUID(),
        ...payload,
        createdAt: Date.now(),
      });
    }

    save();
    updateKpis();
    renderTable();
    closeModal();
  }

  function onProgressInput() {
    els.progressLabel.textContent = els.progress.value + "%";
  }

  function init() {
    load();
    updateKpis();
    renderTable();
    refreshIcons();

    document.getElementById("btn-new-order").addEventListener("click", openNew);
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("form-cancel").addEventListener("click", closeModal);
    els.backdrop.addEventListener("click", closeModal);
    els.form.addEventListener("submit", onSubmit);
    els.progress.addEventListener("input", onProgressInput);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (els.panel.classList.contains("is-open")) closeModal();
        else closeSidebarUi();
      }
    });

    const btnMenu = document.getElementById("btn-menu");
    const sbBackdrop = document.getElementById("sidebar-backdrop");
    if (btnMenu) btnMenu.addEventListener("click", toggleSidebarUi);
    if (sbBackdrop) sbBackdrop.addEventListener("click", closeSidebarUi);

    document.querySelectorAll("#sidebar .nav-link").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeSidebarUi();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
