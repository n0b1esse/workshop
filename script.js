/**
 * Sewing Broker Dashboard — data layer, UI, persistence
 * Budget = source; distribution = workshop + materials + logistics; pocket = profit.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "sewing-broker-dashboard-v2";

  /** @typedef {'Draft'|'Sampling'|'Production'|'QC'|'Shipped'} OrderStatus */

  /**
   * @typedef {Object} Order
   * @property {string} id
   * @property {string} orderName
   * @property {string} clientName
   * @property {number} clientBudget
   * @property {number} quantity
   * @property {number} factoryPricePerUnit
   * @property {number} materialCosts
   * @property {number} logisticsMisc
   * @property {number} progressPercent
   * @property {OrderStatus} status
   * @property {number} createdAt
   */

  /** @type {Order[]} */
  let orders = [];

  let searchQuery = "";

  const STATUS_BADGE = {
    Draft: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    Sampling: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    Production: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
    QC: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
    Shipped: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  };

  const els = {
    body: document.getElementById("orders-body"),
    cards: document.getElementById("orders-cards"),
    empty: document.getElementById("empty-state"),
    count: document.getElementById("order-count"),
    search: document.getElementById("search-input"),
    kpiRevenue: document.getElementById("kpi-revenue"),
    kpiExpenses: document.getElementById("kpi-expenses"),
    kpiProfit: document.getElementById("kpi-profit"),
    kpiMargin: document.getElementById("kpi-margin"),
    backdrop: document.getElementById("modal-backdrop"),
    panel: document.getElementById("modal-panel"),
    form: document.getElementById("order-form"),
    title: document.getElementById("modal-title"),
    editId: document.getElementById("edit-id"),
    submit: document.getElementById("form-submit"),
    err: document.getElementById("form-error"),
    emptyMsg: document.getElementById("empty-message"),
    progress: document.getElementById("progress"),
    progressLabel: document.getElementById("progress-label"),
    remainingLabel: document.getElementById("remaining-label"),
    segFactory: document.getElementById("seg-factory"),
    segMaterials: document.getElementById("seg-materials"),
    segLogistics: document.getElementById("seg-logistics"),
    segPocket: document.getElementById("seg-pocket"),
  };

  /** @param {Order} o */
  function compute(o) {
    const workshopCost = o.quantity * o.factoryPricePerUnit;
    const materials = o.materialCosts;
    const logistics = o.logisticsMisc || 0;
    const totalExpenses = workshopCost + materials + logistics;
    const profit = o.clientBudget - totalExpenses;
    const marginPct = o.clientBudget > 0 ? (profit / o.clientBudget) * 100 : 0;
    return {
      workshopCost,
      materials,
      logistics,
      totalExpenses,
      profit,
      marginPct,
    };
  }

  /** Bar segment widths (% of bar) — scaled to 100% if spend + pocket exceeds budget */
  function distributionWidths(budget, workshop, materials, logistics, profit) {
    if (budget <= 0) return [0, 0, 0, 0];
    const pw = (workshop / budget) * 100;
    const pm = (materials / budget) * 100;
    const pl = (logistics / budget) * 100;
    const pp = profit > 0 ? (profit / budget) * 100 : 0;
    const sum = pw + pm + pl + pp;
    if (sum <= 100 || sum === 0) return [pw, pm, pl, pp];
    const s = 100 / sum;
    return [pw * s, pm * s, pl * s, pp * s];
  }

  function formatMoney(n) {
    const sign = n < 0 ? "−" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatPct(n) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  }

  function profitClass(marginPct) {
    if (marginPct < 10) return "profit-warn tabular-nums";
    if (marginPct > 20) return "profit-ok tabular-nums";
    return "font-semibold tabular-nums text-slate-800";
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (Array.isArray(p)) orders = p.map(normalizeOrder);
    } catch (e) {
      console.warn("Load failed", e);
    }
  }

  /** @param {Partial<Order>} o */
  function normalizeOrder(o) {
    return {
      ...o,
      logisticsMisc: typeof o.logisticsMisc === "number" ? o.logisticsMisc : 0,
    };
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  }

  function refreshIcons() {
    if (typeof lucide !== "undefined" && lucide.createIcons) lucide.createIcons();
  }

  function getFilteredOrders() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      return (
        o.orderName.toLowerCase().includes(q) ||
        o.clientName.toLowerCase().includes(q)
      );
    });
  }

  /** Summary cards reflect all orders; search only filters the list below. */
  function updateKpis() {
    let rev = 0;
    let exp = 0;
    let prof = 0;
    orders.forEach((o) => {
      const c = compute(o);
      rev += o.clientBudget;
      exp += c.totalExpenses;
      prof += c.profit;
    });
    const avgMargin = rev > 0 ? (prof / rev) * 100 : 0;

    els.kpiRevenue.textContent = formatMoney(rev);
    els.kpiExpenses.textContent = formatMoney(exp);
    els.kpiProfit.textContent = formatMoney(prof);
    els.kpiMargin.textContent = formatPct(avgMargin);

    const filtered = getFilteredOrders();
    const n = filtered.length;
    const total = orders.length;
    els.count.textContent =
      searchQuery.trim() && n !== total
        ? n + " of " + total + " shown"
        : n === 1
          ? "1 order"
          : n + " orders";
  }

  function updateBudgetLeakFromForm() {
    const budget = parseFloat(document.getElementById("client-budget").value) || 0;
    const qty = parseInt(document.getElementById("quantity").value, 10) || 0;
    const fp = parseFloat(document.getElementById("factory-price").value) || 0;
    const mat = parseFloat(document.getElementById("material-costs").value) || 0;
    const log = parseFloat(document.getElementById("logistics-misc").value) || 0;

    const workshop = qty * fp;
    const profit = budget - (workshop + mat + log);
    const [w, m, l, p] = distributionWidths(budget, workshop, mat, log, profit);

    els.segFactory.style.width = w + "%";
    els.segMaterials.style.width = m + "%";
    els.segLogistics.style.width = l + "%";
    els.segPocket.style.width = p + "%";

    if (budget <= 0) {
      els.remainingLabel.textContent = "Remaining: —";
      els.remainingLabel.className = "tabular-nums font-semibold text-slate-900";
      return;
    }
    els.remainingLabel.textContent = "Remaining: " + formatMoney(profit) + " (" + formatPct((profit / budget) * 100) + ")";
    els.remainingLabel.className =
      profit < 0
        ? "tabular-nums font-semibold text-red-600"
        : "tabular-nums font-semibold text-emerald-700";
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  /** Animate progress fills after paint */
  function animateProgressBars() {
    requestAnimationFrame(() => {
      document.querySelectorAll("[data-progress-target]").forEach((el) => {
        const t = parseFloat(el.getAttribute("data-progress-target") || "0");
        el.style.width = Math.min(100, Math.max(0, t)) + "%";
      });
    });
  }

  function renderTable() {
    if (els.body) els.body.innerHTML = "";
    if (els.cards) els.cards.innerHTML = "";

    const list = [...getFilteredOrders()].sort((a, b) => b.createdAt - a.createdAt);

    if (list.length === 0) {
      els.empty.classList.remove("hidden");
      if (els.emptyMsg) {
        els.emptyMsg.innerHTML =
          orders.length === 0
            ? 'No orders yet. Tap <strong class="text-slate-800">New order</strong> to start from the client budget.'
            : "No orders match your search. Try another name or clear the search box.";
      }
      updateKpis();
      refreshIcons();
      return;
    }
    els.empty.classList.add("hidden");

    list.forEach((o, idx) => {
      const c = compute(o);
      const pct = Math.min(100, Math.max(0, o.progressPercent));
      const badge = STATUS_BADGE[o.status] || STATUS_BADGE.Draft;
      const pCls = profitClass(c.marginPct);

      if (els.body) {
        const tr = document.createElement("tr");
        tr.className = "order-row row-enter border-slate-100";
        tr.style.animationDelay = idx * 0.04 + "s";
        tr.innerHTML = `
          <td class="px-5 py-3">
            <button type="button" class="expand-btn flex items-start gap-2 text-left font-medium text-slate-900 hover:text-slate-700" data-id="${o.id}" aria-expanded="false">
              <i data-lucide="chevron-right" class="icon-chevron mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform" aria-hidden="true"></i>
              <span>${escapeHtml(o.orderName)}</span>
            </button>
          </td>
          <td class="px-5 py-3 text-slate-600">${escapeHtml(o.clientName)}</td>
          <td class="px-5 py-3 ${pCls}">${formatMoney(c.profit)}</td>
          <td class="px-5 py-3">
            <div class="progress-bar-bg" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-bar-fill" data-progress-target="${pct}" style="width:0%"></div>
            </div>
          </td>
          <td class="px-5 py-3">
            <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge}">${escapeHtml(o.status)}</span>
          </td>
          <td class="px-5 py-3 text-right whitespace-nowrap">
            <button type="button" class="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" data-act="edit" data-id="${o.id}">Edit</button>
            <button type="button" class="rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50" data-act="del" data-id="${o.id}">Delete</button>
          </td>
        `;

        const trExp = document.createElement("tr");
        trExp.className = "bg-slate-50/90";
        trExp.innerHTML = `
          <td colspan="6" class="p-0">
            <div class="order-expand" id="ex-${o.id}">
              <div class="order-expand-inner">
                <div class="border-t border-slate-100 px-5 py-5">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Where the budget went</p>
                  <div class="mt-4 grid gap-4 sm:grid-cols-3">
                    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p class="text-[10px] font-semibold uppercase text-slate-400">Workshop</p>
                      <p class="mt-1 text-lg font-bold tabular-nums text-slate-900">${formatMoney(c.workshopCost)}</p>
                      <p class="mt-1 text-xs text-slate-500">${formatPct(o.clientBudget > 0 ? (c.workshopCost / o.clientBudget) * 100 : 0)} of budget</p>
                    </div>
                    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p class="text-[10px] font-semibold uppercase text-slate-400">Materials</p>
                      <p class="mt-1 text-lg font-bold tabular-nums text-amber-700">${formatMoney(c.materials)}</p>
                      <p class="mt-1 text-xs text-slate-500">${formatPct(o.clientBudget > 0 ? (c.materials / o.clientBudget) * 100 : 0)} of budget</p>
                    </div>
                    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p class="text-[10px] font-semibold uppercase text-slate-400">Your pocket</p>
                      <p class="mt-1 text-lg font-bold tabular-nums ${c.profit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(c.profit)}</p>
                      <p class="mt-1 text-xs text-slate-500">Net after workshop + materials + logistics</p>
                    </div>
                  </div>
                  <div class="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-600">
                    Logistics &amp; misc: <strong class="tabular-nums text-slate-800">${formatMoney(c.logistics)}</strong>
                    · Margin: <strong class="${c.marginPct < 10 ? "text-red-600" : c.marginPct > 20 ? "text-emerald-600" : "text-slate-800"}">${formatPct(c.marginPct)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </td>
        `;
        els.body.appendChild(tr);
        els.body.appendChild(trExp);
      }

      if (els.cards) {
        const card = document.createElement("div");
        card.className = "order-card-mob card-enter rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
        card.style.animationDelay = idx * 0.04 + "s";
        card.innerHTML = `
          <button type="button" class="expand-btn flex w-full items-start gap-2 text-left" data-id="${o.id}" aria-expanded="false">
            <i data-lucide="chevron-right" class="icon-chevron mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true"></i>
            <span class="min-w-0 flex-1">
              <span class="block font-semibold text-slate-900">${escapeHtml(o.orderName)}</span>
              <span class="text-xs text-slate-500">${escapeHtml(o.clientName)}</span>
            </span>
          </button>
          <div class="mt-3 flex items-center justify-between gap-2">
            <span class="text-[10px] uppercase text-slate-400">Profit</span>
            <span class="text-base ${pCls}">${formatMoney(c.profit)}</span>
          </div>
          <div class="mt-2">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" data-progress-target="${pct}" style="width:0%"></div>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge}">${escapeHtml(o.status)}</span>
            <div class="flex gap-1">
              <button type="button" class="rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100" data-act="edit" data-id="${o.id}">Edit</button>
              <button type="button" class="rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50" data-act="del" data-id="${o.id}">Delete</button>
            </div>
          </div>
          <div class="order-expand mt-3" id="ex-mob-${o.id}">
            <div class="order-expand-inner">
              <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p class="text-xs font-semibold uppercase text-slate-500">Where the budget went</p>
                <ul class="mt-3 space-y-2 text-sm">
                  <li class="flex justify-between"><span class="text-slate-500">Workshop</span><span class="font-medium tabular-nums">${formatMoney(c.workshopCost)}</span></li>
                  <li class="flex justify-between"><span class="text-slate-500">Materials</span><span class="font-medium tabular-nums">${formatMoney(c.materials)}</span></li>
                  <li class="flex justify-between"><span class="text-slate-500">Logistics &amp; misc</span><span class="font-medium tabular-nums">${formatMoney(c.logistics)}</span></li>
                  <li class="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span class="text-slate-700">Your pocket</span><span class="${c.profit >= 0 ? "text-emerald-600" : "text-red-600"} tabular-nums">${formatMoney(c.profit)}</span></li>
                </ul>
                <p class="mt-2 text-xs text-slate-500">Margin ${formatPct(c.marginPct)} · ${formatPct(o.clientBudget > 0 ? (c.workshopCost / o.clientBudget) * 100 : 0)} workshop / budget</p>
              </div>
            </div>
          </div>
        `;
        els.cards.appendChild(card);
      }
    });

    bindRowEvents();
    updateKpis();
    refreshIcons();
    animateProgressBars();
  }

  function bindRowEvents() {
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
    } else {
      wrap.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      if (chev) chev.style.transform = "rotate(90deg)";
    }
  }

  function openModal(isEdit) {
    els.backdrop.classList.add("is-open");
    els.backdrop.setAttribute("aria-hidden", "false");
    els.panel.classList.add("is-open");
    els.panel.classList.remove("opacity-0", "pointer-events-none");
    els.panel.classList.add("opacity-100", "pointer-events-auto");
    els.title.textContent = isEdit ? "Edit order" : "New order";
    els.submit.textContent = isEdit ? "Update" : "Save order";
    document.body.style.overflow = "hidden";
    updateBudgetLeakFromForm();
    refreshIcons();
  }

  function closeModal() {
    els.backdrop.classList.remove("is-open");
    els.backdrop.setAttribute("aria-hidden", "true");
    els.panel.classList.remove("is-open", "opacity-100", "pointer-events-auto");
    els.panel.classList.add("opacity-0", "pointer-events-none");
    document.body.style.overflow = "";
    hideErr();
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
    document.getElementById("quantity").value = "1";
    document.getElementById("progress").value = "0";
    els.progressLabel.textContent = "0";
    openModal(false);
  }

  function openEdit(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    els.editId.value = o.id;
    document.getElementById("order-name").value = o.orderName;
    document.getElementById("client-name").value = o.clientName;
    document.getElementById("client-budget").value = String(o.clientBudget);
    document.getElementById("quantity").value = String(o.quantity);
    document.getElementById("factory-price").value = String(o.factoryPricePerUnit);
    document.getElementById("material-costs").value = String(o.materialCosts);
    document.getElementById("logistics-misc").value = String(o.logisticsMisc ?? 0);
    document.getElementById("progress").value = String(o.progressPercent);
    document.getElementById("status").value = o.status;
    els.progressLabel.textContent = String(o.progressPercent);
    openModal(true);
  }

  function removeOrder(id) {
    if (!id || !confirm("Delete this order?")) return;
    orders = orders.filter((o) => o.id !== id);
    save();
    renderTable();
  }

  function onSubmit(e) {
    e.preventDefault();
    hideErr();

    const orderName = document.getElementById("order-name").value.trim();
    const clientName = document.getElementById("client-name").value.trim();
    const clientBudget = parseFloat(document.getElementById("client-budget").value);
    const quantity = parseInt(document.getElementById("quantity").value, 10);
    const factoryPrice = parseFloat(document.getElementById("factory-price").value);
    const materialCosts = parseFloat(document.getElementById("material-costs").value);
    const logisticsMisc = parseFloat(document.getElementById("logistics-misc").value);
    const progressPercent = parseInt(els.progress.value, 10);
    /** @type {OrderStatus} */
    const status = document.getElementById("status").value;
    const edit = els.editId.value.trim();

    if (!orderName || !clientName) {
      showErr("Order name and client are required.");
      return;
    }
    if (Number.isNaN(clientBudget) || clientBudget < 0) {
      showErr("Enter a valid client budget.");
      return;
    }
    if (Number.isNaN(quantity) || quantity < 1) {
      showErr("Quantity must be at least 1.");
      return;
    }
    if (Number.isNaN(factoryPrice) || factoryPrice < 0) {
      showErr("Workshop price per unit must be valid.");
      return;
    }
    if (Number.isNaN(materialCosts) || materialCosts < 0 || Number.isNaN(logisticsMisc) || logisticsMisc < 0) {
      showErr("Material and logistics costs must be non-negative.");
      return;
    }

    const payload = {
      orderName,
      clientName,
      clientBudget,
      quantity,
      factoryPricePerUnit: factoryPrice,
      materialCosts,
      logisticsMisc,
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
    closeModal();
    renderTable();
  }

  function onSearchInput() {
    searchQuery = els.search.value;
    renderTable();
  }

  function wireBudgetLeakInputs() {
    const ids = ["client-budget", "quantity", "factory-price", "material-costs", "logistics-misc"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", updateBudgetLeakFromForm);
    });
  }

  function init() {
    load();
    renderTable();

    document.getElementById("btn-new-order").addEventListener("click", openNew);
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("form-cancel").addEventListener("click", closeModal);
    els.backdrop.addEventListener("click", closeModal);
    els.form.addEventListener("submit", onSubmit);
    els.search.addEventListener("input", onSearchInput);
    els.progress.addEventListener("input", () => {
      els.progressLabel.textContent = els.progress.value;
    });
    wireBudgetLeakInputs();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.panel.classList.contains("is-open")) closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
