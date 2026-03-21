/**
 * Sewing Management Dashboard — core logic, persistence, charts
 * @module DashboardApp
 */

(function () {
  "use strict";

  /** @typedef {'Planning'|'Cutting'|'Sewing'|'QC'|'Shipped'} OrderStatus */

  /**
   * @typedef {Object} Order
   * @property {string} id
   * @property {string} projectName
   * @property {'perUnit'|'total'} budgetMode
   * @property {number} clientBudgetInput — raw number from form (per unit OR total)
   * @property {number} factoryPricePerUnit
   * @property {number} quantity
   * @property {number} materialCostsTotal
   * @property {OrderStatus} status
   * @property {number} createdAt — epoch ms
   */

  const STORAGE_KEY = "sewing-dashboard-orders-v1";

  /** Progress % for status bar (pipeline) */
  const STATUS_PROGRESS = {
    Planning: 12,
    Cutting: 32,
    Sewing: 55,
    QC: 82,
    Shipped: 100,
  };

  /** Tailwind-friendly badge classes */
  const STATUS_BADGE = {
    Planning: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80",
    Cutting: "bg-blue-50 text-blue-800 ring-1 ring-blue-200/80",
    Sewing: "bg-orange-50 text-orange-800 ring-1 ring-orange-200/80",
    QC: "bg-violet-50 text-violet-800 ring-1 ring-violet-200/80",
    Shipped: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80",
  };

  /** @type {Order[]} */
  let orders = [];

  /** @type {Record<string, import('chart.js').Chart>} */
  const chartInstances = {};

  // ——— DOM ———
  const els = {
    tbody: document.getElementById("orders-tbody"),
    empty: document.getElementById("empty-state"),
    kpiActive: document.getElementById("kpi-active-orders"),
    kpiProfit: document.getElementById("kpi-net-profit"),
    kpiMargin: document.getElementById("kpi-avg-margin"),
    kpiCompletion: document.getElementById("kpi-completion"),
    ordersLabel: document.getElementById("orders-count-label"),
    savedIndicator: document.getElementById("saved-indicator"),
    backdrop: document.getElementById("modal-backdrop"),
    panel: document.getElementById("form-panel"),
    form: document.getElementById("order-form"),
    formTitle: document.getElementById("form-title"),
    editId: document.getElementById("edit-id"),
    btnOpen: document.getElementById("btn-open-form"),
    btnClose: document.getElementById("btn-close-form"),
    btnCancel: document.getElementById("btn-cancel-form"),
    budgetRadios: () => document.querySelectorAll('input[name="budgetMode"]'),
    budgetHint: document.getElementById("budget-hint"),
    formError: document.getElementById("form-error"),
    submitBtn: document.getElementById("btn-submit-form"),
  };

  // ——— Math ———

  /**
   * Derive client unit price from mode + inputs.
   * @param {'perUnit'|'total'} mode
   * @param {number} budgetInput
   * @param {number} qty
   */
  function getClientUnitPrice(mode, budgetInput, qty) {
    if (mode === "perUnit") return budgetInput;
    if (qty <= 0) return 0;
    return budgetInput / qty;
  }

  /**
   * Full financial snapshot for an order.
   * @param {Order} o
   */
  function computeMetrics(o) {
    const q = o.quantity;
    const clientUnit = getClientUnitPrice(o.budgetMode, o.clientBudgetInput, q);
    const revenue = q * clientUnit;
    const factoryCost = q * o.factoryPricePerUnit;
    const totalCosts = factoryCost + o.materialCostsTotal;
    const netProfit = revenue - totalCosts;
    const marginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;
    const markupPct = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;
    return {
      clientUnitPrice: clientUnit,
      revenue,
      factoryCost,
      totalCosts,
      netProfit,
      marginPct,
      markupPct,
    };
  }

  // ——— Persistence ———

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) orders = parsed;
    } catch (e) {
      console.warn("Dashboard: could not load storage", e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      if (els.savedIndicator) {
        els.savedIndicator.textContent = "Synced";
        els.savedIndicator.classList.add("text-emerald-400/90");
      }
    } catch (e) {
      if (els.savedIndicator) {
        els.savedIndicator.textContent = "Save failed";
        els.savedIndicator.classList.remove("text-emerald-400/90");
        els.savedIndicator.classList.add("text-amber-400");
      }
    }
  }

  // ——— Dashboard KPIs ———

  function pulse(el) {
    if (!el) return;
    el.classList.remove("value-updated");
    void el.offsetWidth;
    el.classList.add("value-updated");
  }

  function updateKpis() {
    const total = orders.length;
    const active = orders.filter((o) => o.status !== "Shipped").length;
    const shipped = orders.filter((o) => o.status === "Shipped").length;

    let sumNet = 0;
    let sumMargin = 0;
    orders.forEach((o) => {
      const m = computeMetrics(o);
      sumNet += m.netProfit;
      sumMargin += m.marginPct;
    });

    const avgMargin = total > 0 ? sumMargin / total : 0;
    const completion = total > 0 ? (shipped / total) * 100 : 0;

    els.kpiActive.textContent = String(active);
    els.kpiProfit.textContent = formatMoney(sumNet);
    els.kpiMargin.textContent = formatPct(avgMargin);
    els.kpiCompletion.textContent = formatPct(completion);
    els.ordersLabel.textContent = total === 1 ? "1 order" : `${total} orders`;

    [els.kpiActive, els.kpiProfit, els.kpiMargin, els.kpiCompletion].forEach(pulse);
  }

  function formatMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatPct(n) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  }

  // ——— Table rendering ———

  function renderTable() {
    els.tbody.innerHTML = "";
    if (orders.length === 0) {
      els.empty.classList.remove("hidden");
      return;
    }
    els.empty.classList.add("hidden");

    const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

    sorted.forEach((o) => {
      const m = computeMetrics(o);
      const pct = STATUS_PROGRESS[o.status] ?? 0;
      const badgeClass = STATUS_BADGE[o.status] || STATUS_BADGE.Planning;

      const trMain = document.createElement("tr");
      trMain.className = "order-row-main border-slate-100 hover:bg-slate-50/80";
      trMain.dataset.orderId = o.id;

      trMain.innerHTML = `
        <td class="px-5 py-3">
          <button type="button" class="expand-toggle text-left font-medium text-slate-900 hover:text-emerald-700 flex items-center gap-2 group" data-expand="${o.id}" aria-expanded="false">
            <span class="inline-block transition-transform duration-300 text-slate-400 group-hover:text-emerald-600" data-chevron>▸</span>
            ${escapeHtml(o.projectName)}
          </button>
        </td>
        <td class="px-5 py-3 tabular-nums text-slate-600">${o.quantity}</td>
        <td class="px-5 py-3 tabular-nums font-medium text-slate-800">${formatMoney(m.revenue)}</td>
        <td class="px-5 py-3 tabular-nums font-semibold ${m.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.netProfit)}</td>
        <td class="px-5 py-3 tabular-nums text-indigo-600">${formatPct(m.marginPct)}</td>
        <td class="px-5 py-3">
          <div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill bg-gradient-to-r from-emerald-500 to-teal-500" style="width:${pct}%"></div>
          </div>
        </td>
        <td class="px-5 py-3">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass}">${escapeHtml(o.status)}</span>
        </td>
        <td class="px-5 py-3 text-right space-x-2 whitespace-nowrap">
          <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors" data-action="edit" data-id="${o.id}">Edit</button>
          <button type="button" class="text-xs font-medium text-red-600 hover:text-red-800 px-2 py-1 rounded-md hover:bg-red-50 transition-colors" data-action="delete" data-id="${o.id}">Delete</button>
        </td>
      `;

      const trExpand = document.createElement("tr");
      trExpand.className = "bg-slate-50/50";
      trExpand.innerHTML = `
        <td colspan="8" class="p-0 border-none">
          <div class="order-expand" id="expand-wrap-${o.id}">
            <div class="order-expand-inner">
              <div class="px-5 py-6 border-t border-slate-100 grid md:grid-cols-2 gap-8 items-start">
                <div class="space-y-3 text-sm">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Financial breakdown</p>
                  <dl class="grid grid-cols-2 gap-x-4 gap-y-2 max-w-md">
                    <dt class="text-slate-500">Client unit price</dt><dd class="tabular-nums text-right font-medium">${formatMoney(m.clientUnitPrice)}</dd>
                    <dt class="text-slate-500">Revenue</dt><dd class="tabular-nums text-right font-semibold text-slate-900">${formatMoney(m.revenue)}</dd>
                    <dt class="text-slate-500">Factory cost (total)</dt><dd class="tabular-nums text-right">${formatMoney(m.factoryCost)}</dd>
                    <dt class="text-slate-500">Materials (total)</dt><dd class="tabular-nums text-right">${formatMoney(o.materialCostsTotal)}</dd>
                    <dt class="text-slate-500">Total costs</dt><dd class="tabular-nums text-right">${formatMoney(m.totalCosts)}</dd>
                    <dt class="text-slate-500">Net profit</dt><dd class="tabular-nums text-right font-semibold ${m.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}">${formatMoney(m.netProfit)}</dd>
                    <dt class="text-slate-500">Margin %</dt><dd class="tabular-nums text-right text-indigo-600">${formatPct(m.marginPct)}</dd>
                    <dt class="text-slate-500">Markup %</dt><dd class="tabular-nums text-right text-slate-700">${formatPct(m.markupPct)}</dd>
                  </dl>
                </div>
                <div class="chart-wrap">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 text-center mb-3">Cost &amp; profit split</p>
                  <canvas id="chart-${o.id}" height="200" aria-label="Doughnut chart for this order"></canvas>
                  <p class="chart-note text-xs text-center mt-2 text-red-600 hidden"></p>
                </div>
              </div>
            </div>
          </div>
        </td>
      `;

      els.tbody.appendChild(trMain);
      els.tbody.appendChild(trExpand);

      // Stagger row entrance
      trMain.style.opacity = "0";
      trMain.style.transform = "translateY(8px)";
      requestAnimationFrame(() => {
        trMain.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1)";
        trMain.style.opacity = "1";
        trMain.style.transform = "translateY(0)";
      });
    });

    bindTableEvents();
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function bindTableEvents() {
    els.tbody.querySelectorAll(".expand-toggle").forEach((btn) => {
      btn.addEventListener("click", onToggleExpand);
    });
    els.tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEdit(btn.dataset.id);
      });
    });
    els.tbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeOrder(btn.dataset.id);
      });
    });
  }

  /**
   * @param {Event} e
   */
  function onToggleExpand(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.expand;
    const wrap = document.getElementById("expand-wrap-" + id);
    const mainRow = btn.closest("tr");
    const chevron = btn.querySelector("[data-chevron]");
    const isOpen = wrap.classList.contains("is-open");

    if (isOpen) {
      wrap.classList.remove("is-open");
      mainRow.classList.remove("is-expanded");
      btn.setAttribute("aria-expanded", "false");
      if (chevron) chevron.style.transform = "rotate(0deg)";
      destroyChart(id);
    } else {
      wrap.classList.add("is-open");
      mainRow.classList.add("is-expanded");
      btn.setAttribute("aria-expanded", "true");
      if (chevron) chevron.style.transform = "rotate(90deg)";
      const order = orders.find((x) => x.id === id);
      if (order) {
        requestAnimationFrame(() => renderDoughnut(order));
      }
    }
  }

  /**
   * Doughnut: segments for factory cost, materials, net profit (can be negative — clamp display)
   * @param {Order} o
   */
  function renderDoughnut(o) {
    const id = o.id;
    const canvas = document.getElementById("chart-" + id);
    if (!canvas || typeof Chart === "undefined") return;

    destroyChart(id);
    const m = computeMetrics(o);

    const factory = Math.max(0, m.factoryCost);
    const materials = Math.max(0, o.materialCostsTotal);
    const profit = m.netProfit;
    /** Doughnut requires non-negative segments; loss is explained in tooltip + note */
    const profitDisplay = Math.max(0, profit);

    const data = [factory, materials, profitDisplay];
    const labels = ["Factory costs", "Materials", "Net profit"];

    const noteEl = canvas.closest(".chart-wrap")?.querySelector(".chart-note");
    if (noteEl) {
      if (profit < 0) {
        noteEl.textContent = "Net profit is negative — review pricing or costs.";
        noteEl.classList.remove("hidden");
      } else {
        noteEl.textContent = "";
        noteEl.classList.add("hidden");
      }
    }

    chartInstances[id] = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: [
              "rgb(71 85 105)", /* slate-600 */
              "rgb(245 158 11)", /* amber-500 */
              "rgb(5 150 105)", /* emerald-600 */
            ],
            borderWidth: 0,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "62%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, family: "Inter, system-ui, sans-serif" },
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                const lab = ctx.label || "";
                const money = typeof v === "number" ? formatMoney(v) : v;
                if (lab === "Net profit" && m.netProfit < 0) {
                  return `${lab}: ${formatMoney(m.netProfit)} (loss)`;
                }
                return `${lab}: ${money}`;
              },
            },
          },
        },
      },
    });
  }

  function destroyChart(id) {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  }

  // ——— CRUD ———

  function openForm(isEdit) {
    els.backdrop.classList.add("is-open");
    els.panel.classList.add("is-open");
    els.formTitle.textContent = isEdit ? "Edit order" : "New order";
    els.submitBtn.textContent = isEdit ? "Update order" : "Save order";
    document.body.style.overflow = "hidden";
  }

  function closeForm() {
    els.backdrop.classList.remove("is-open");
    els.panel.classList.remove("is-open");
    document.body.style.overflow = "";
    hideFormError();
  }

  function openNew() {
    els.form.reset();
    els.editId.value = "";
    setBudgetMode("perUnit");
    updateBudgetHint();
    openForm(false);
  }

  /**
   * @param {string} id
   */
  function openEdit(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    els.editId.value = o.id;
    document.getElementById("project-name").value = o.projectName;
    setBudgetMode(o.budgetMode);
    document.getElementById("client-budget").value = String(o.clientBudgetInput);
    document.getElementById("factory-price").value = String(o.factoryPricePerUnit);
    document.getElementById("quantity").value = String(o.quantity);
    document.getElementById("material-costs").value = String(o.materialCostsTotal);
    document.getElementById("status").value = o.status;
    updateBudgetHint();
    openForm(true);
  }

  function setBudgetMode(mode) {
    els.budgetRadios().forEach((r) => {
      r.checked = r.value === mode;
    });
  }

  function getBudgetMode() {
    const sel = Array.from(els.budgetRadios()).find((r) => r.checked);
    return sel && sel.value === "total" ? "total" : "perUnit";
  }

  function updateBudgetHint() {
    const mode = getBudgetMode();
    els.budgetHint.textContent =
      mode === "perUnit" ? "Unit price charged to client." : "Total client budget; unit price = budget ÷ quantity.";
  }

  function hideFormError() {
    els.formError.classList.add("hidden");
    els.formError.textContent = "";
  }

  function showFormError(msg) {
    els.formError.textContent = msg;
    els.formError.classList.remove("hidden");
  }

  /**
   * @param {Event} e
   */
  function onSubmit(e) {
    e.preventDefault();
    hideFormError();

    const projectName = document.getElementById("project-name").value.trim();
    const budgetMode = getBudgetMode();
    const clientBudget = parseFloat(document.getElementById("client-budget").value);
    const factoryPrice = parseFloat(document.getElementById("factory-price").value);
    const quantity = parseInt(document.getElementById("quantity").value, 10);
    const materialCosts = parseFloat(document.getElementById("material-costs").value);
    /** @type {OrderStatus} */
    const status = document.getElementById("status").value;
    const editId = els.editId.value.trim();

    if (!projectName) {
      showFormError("Project name is required.");
      return;
    }
    if (Number.isNaN(clientBudget) || clientBudget < 0) {
      showFormError("Client budget must be a non-negative number.");
      return;
    }
    if (Number.isNaN(factoryPrice) || factoryPrice < 0) {
      showFormError("Factory price must be a non-negative number.");
      return;
    }
    if (Number.isNaN(quantity) || quantity < 1) {
      showFormError("Quantity must be at least 1.");
      return;
    }
    if (budgetMode === "total" && clientBudget <= 0) {
      showFormError("Total budget must be greater than 0.");
      return;
    }
    if (Number.isNaN(materialCosts) || materialCosts < 0) {
      showFormError("Material costs must be a non-negative number.");
      return;
    }

    const snapshot = {
      projectName,
      budgetMode,
      clientBudgetInput: clientBudget,
      factoryPricePerUnit: factoryPrice,
      quantity,
      materialCostsTotal: materialCosts,
      status,
    };

    if (editId) {
      const idx = orders.findIndex((x) => x.id === editId);
      if (idx === -1) return;
      orders[idx] = { ...orders[idx], ...snapshot };
    } else {
      orders.push({
        id: crypto.randomUUID(),
        ...snapshot,
        createdAt: Date.now(),
      });
    }

    save();
    updateKpis();
    renderTable();
    closeForm();
  }

  /**
   * @param {string} id
   */
  function removeOrder(id) {
    if (!confirm("Delete this order? This cannot be undone.")) return;
    destroyChart(id);
    orders = orders.filter((o) => o.id !== id);
    save();
    updateKpis();
    renderTable();
  }

  // ——— Init ———

  function init() {
    load();
    updateKpis();
    renderTable();

    els.btnOpen.addEventListener("click", openNew);
    els.btnClose.addEventListener("click", closeForm);
    els.btnCancel.addEventListener("click", closeForm);
    els.backdrop.addEventListener("click", closeForm);
    els.form.addEventListener("submit", onSubmit);

    els.budgetRadios().forEach((r) => r.addEventListener("change", updateBudgetHint));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.panel.classList.contains("is-open")) closeForm();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
