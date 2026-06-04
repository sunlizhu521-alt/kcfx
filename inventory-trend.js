const TREND_MONTHS = [
  { id: "fact-3", label: "1月" },
  { id: "fact-4", label: "2月" },
  { id: "fact-5", label: "3月" },
  { id: "fact-6", label: "4月" }
];

const TREND_COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de"];
const TREND_TOP_LIMIT = 8;
const TREND_FILTERS = [
  { id: "departmentTrendFilter", field: "department", allLabel: "数量最大事业部" },
  { id: "productTrendFilter", field: "productLine", allLabel: "数量最大产品线" },
  { id: "warehouseLocationTrendFilter", field: "warehouseLocation", allLabel: "数量最大仓库位置" }
];
let trendUnclassifiedRows = [];
let currentTrendMonthSummaries = [];

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.querySelector("#summaryStatus");
  document.querySelector("#downloadTrendUnclassifiedBtn")?.addEventListener("click", downloadTrendUnclassifiedRows);
  document.querySelector("#clearTrendFiltersBtn")?.addEventListener("click", clearTrendFilters);
  document.addEventListener("click", closeTrendFilters);
  await loadSharedLibrary({ statusEl });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  renderTrendDashboard(records);
});

function renderTrendDashboard(records) {
  const maps = buildTrendDimensionMaps(records);
  const monthSummaries = TREND_MONTHS.map((month) => summarizeTrendMonth(month, records[month.id], maps));
  const loaded = monthSummaries.filter((item) => item.record).length;
  const usedRows = monthSummaries.reduce((total, item) => total + item.usedRows, 0);
  const totalQty = monthSummaries.reduce((total, item) => total + item.totalQty, 0);

  currentTrendMonthSummaries = monthSummaries;
  setText("#summaryStatus", `已读取 ${loaded}/4 个月份文件，参与趋势计算 ${formatNumber(usedRows, 0)} 行，K列数量合计 ${formatQuantity(totalQty)}。`);
  populateTrendFilters(monthSummaries);
  renderTrendCharts();
  renderTrendSourcePanel(monthSummaries, records);
  trendUnclassifiedRows = monthSummaries.flatMap((item) => item.unclassifiedRows);
  renderTrendUnclassifiedRows(trendUnclassifiedRows);
}

function renderTrendCharts() {
  renderVerticalTrendChart("departmentTrendChart", "departmentTrendTotal", currentTrendMonthSummaries, "department", "未匹配事业部", "departmentTrendFilter");
  renderVerticalTrendChart("productTrendChart", "productTrendTotal", currentTrendMonthSummaries, "productLine", "未分类产品线", "productTrendFilter");
  renderVerticalTrendChart("warehouseLocationTrendChart", "warehouseLocationTrendTotal", currentTrendMonthSummaries, "warehouseLocation", "未分类仓库位置", "warehouseLocationTrendFilter");
}

function summarizeTrendMonth(month, record, maps) {
  const sourceRows = record?.rows || [];
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const summary = {
    ...month,
    record,
    totalRows: sourceRows.length,
    skippedSummaryRows: sourceRows.length ? 1 : 0,
    usedRows: 0,
    totalQty: 0,
    items: [],
    unclassifiedRows: []
  };

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialB = normalizeMaterialCode(nthValue(row, 2));
    const materialName = normalizeText(nthValue(row, 3));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = trendToNumber(nthValue(row, 11));
    if (!qty) continue;

    const department = maps.departmentByKey.get(makeTrendDepartmentKey(materialA, warehouse, materialB)) || "";
    const productLine = maps.productLineByMaterial.get(materialB) || "";
    const warehouseLocation = maps.warehouseLocationByName.get(normalizeText(warehouse)) || "";
    const missingReasons = [
      department ? "" : "未区分事业部",
      productLine ? "" : "未区分产品线",
      warehouseLocation ? "" : "未分类仓库位置"
    ].filter(Boolean);
    summary.usedRows += 1;
    summary.totalQty += qty;
    summary.items.push({
      qty,
      department: department || "未匹配事业部",
      productLine: productLine || "未分类产品线",
      warehouseLocation: warehouseLocation || "未分类仓库位置"
    });
    if (missingReasons.length) {
      summary.unclassifiedRows.push({
        month: month.label,
        reason: missingReasons.join("、"),
        materialA,
        materialCode: materialB,
        materialName,
        warehouse,
        qty,
        department,
        productLine,
        warehouseLocation
      });
    }
  }

  return summary;
}

function renderTrendUnclassifiedRows(rows) {
  const body = document.querySelector("#trendUnclassifiedRows");
  if (!body) return;
  const shown = rows.slice(0, 1000);
  body.innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.month)}</td>
      <td>${escapeHtml(row.reason)}</td>
      <td>${escapeHtml(row.materialA)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td class="num">${formatNumber(row.qty, 3)}</td>
      <td>${escapeHtml(row.department || "未区分")}</td>
      <td>${escapeHtml(row.productLine || "未区分")}</td>
      <td>${escapeHtml(row.warehouseLocation || "未分类")}</td>
    </tr>
  `).join("") : `<tr><td colspan="10" class="empty">暂无未分类明细</td></tr>`;
}

function buildTrendDimensionMaps(records) {
  const departmentByKey = new Map();
  for (const row of records["dim-warehouse-material"]?.rows || []) {
    const key = normalizeTrendDepartmentKey(nthValue(row, 6));
    const department = normalizeText(nthValue(row, 7));
    if (key && department && !departmentByKey.has(key)) departmentByKey.set(key, department);
  }

  const warehouseLocationByName = new Map();
  for (const row of records["dim-warehouse"]?.rows || []) {
    const warehouseName = normalizeText(nthValue(row, 2));
    const warehouseLocation = normalizeText(nthValue(row, 8));
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) {
      warehouseLocationByName.set(warehouseName, warehouseLocation);
    }
  }

  const productLineByMaterial = new Map();
  for (const row of records["dim-product"]?.rows || []) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const productLine = normalizeText(nthValue(row, 7));
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) {
      productLineByMaterial.set(materialCode, productLine);
    }
  }

  return { departmentByKey, warehouseLocationByName, productLineByMaterial };
}

function populateTrendFilters(monthSummaries) {
  TREND_FILTERS.forEach((filter) => {
    const select = document.querySelector(`#${filter.id}`);
    const options = topTrendCategories(monthSummaries, filter.field, filter.allLabel, 200);
    fillTrendFilter(select, filter.allLabel, options, options[0] || "");
  });
}

function fillTrendFilter(select, allLabel, values, defaultLabel = "") {
  if (!select) return;
  const current = getTrendFilterValues(select.id).filter((value) => values.includes(value));
  select.dataset.allLabel = allLabel;
  select.dataset.defaultLabel = defaultLabel || allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
    </button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${current.length ? "" : "checked"}>
        <span>${escapeHtml(defaultLabel || allLabel)}</span>
      </label>
      ${values.map((value) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(value)}" ${current.includes(value) ? "checked" : ""}>
          <span>${escapeHtml(value)}</span>
        </label>
      `).join("")}
    </div>
  `;
  select.querySelector(".multi-filter-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTrendFilter(select);
  });
  select.querySelector(".multi-filter-menu")?.addEventListener("click", (event) => event.stopPropagation());
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncTrendFilterSelection(select, checkbox);
      updateTrendFilterLabel(select);
      renderTrendCharts();
    });
  });
  updateTrendFilterLabel(select);
}

function getTrendFilterValues(id) {
  if (!id) return [];
  const select = document.querySelector(`#${id}`);
  if (!select) return [];
  return [...select.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function toggleTrendFilter(select) {
  const isOpen = select.classList.contains("open");
  closeTrendFilters();
  select.classList.toggle("open", !isOpen);
  select.querySelector(".multi-filter-button")?.setAttribute("aria-expanded", String(!isOpen));
}

function closeTrendFilters() {
  document.querySelectorAll(".trend-filter-toolbar .multi-filter.open").forEach((select) => {
    select.classList.remove("open");
    select.querySelector(".multi-filter-button")?.setAttribute("aria-expanded", "false");
  });
}

function syncTrendFilterSelection(select, changedCheckbox) {
  const allCheckbox = select.querySelector("input[data-all='true']");
  const itemCheckboxes = [...select.querySelectorAll("input[type='checkbox']:not([data-all='true'])")];
  if (changedCheckbox.dataset.all === "true") {
    if (changedCheckbox.checked) {
      itemCheckboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
    } else if (!itemCheckboxes.some((checkbox) => checkbox.checked)) {
      changedCheckbox.checked = true;
    }
    return;
  }
  if (changedCheckbox.checked && allCheckbox) allCheckbox.checked = false;
  if (!itemCheckboxes.some((checkbox) => checkbox.checked) && allCheckbox) allCheckbox.checked = true;
}

function updateTrendFilterLabel(select) {
  const buttonText = select.querySelector(".multi-filter-button span");
  if (!buttonText) return;
  const values = getTrendFilterValues(select.id);
  if (!values.length) {
    buttonText.textContent = select.dataset.defaultLabel || select.dataset.allLabel || "数量最大";
  } else if (values.length <= 2) {
    buttonText.textContent = values.join("、");
  } else {
    buttonText.textContent = `已选${values.length}项`;
  }
}

function clearTrendFilters() {
  TREND_FILTERS.forEach((filter) => {
    const select = document.querySelector(`#${filter.id}`);
    if (!select) return;
    select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.checked = checkbox.dataset.all === "true";
    });
    updateTrendFilterLabel(select);
  });
  renderTrendCharts();
}

function renderVerticalTrendChart(chartId, totalId, monthSummaries, field, fallbackName, filterId = "") {
  const container = document.querySelector(`#${chartId}`);
  if (!container) return;
  const selected = getTrendFilterValues(filterId);
  const categoryNames = selected.length ? selected : topTrendCategories(monthSummaries, field, fallbackName, 1);
  const total = monthSummaries.reduce((sum, month) => sum + month.totalQty, 0);
  setText(`#${totalId}`, `合计 ${formatQuantity(total)}`);

  if (!categoryNames.length) {
    container.innerHTML = `<div class="empty">暂无趋势数据</div>`;
    return;
  }

  const valuesByCategory = categoryNames.map((name) => ({
    name,
    values: TREND_MONTHS.map((month) => getTrendMonthCategoryValue(monthSummaries, month.label, field, name, fallbackName))
  }));
  const max = Math.max(...valuesByCategory.flatMap((item) => item.values), 1);
  container.innerHTML = `
    <div class="trend-legend">
      ${TREND_MONTHS.map((month, index) => `<span><i style="background:${TREND_COLORS[index]}"></i>${month.label}</span>`).join("")}
    </div>
    <div class="trend-bars-vertical ${trendCategoryDensityClass(valuesByCategory.length)}">
      ${valuesByCategory.map((category) => `
        <div class="trend-category" title="${escapeHtml(category.name)}">
          <div class="trend-bar-group">
            ${category.values.map((value, index) => `
              <div class="trend-bar-wrap" title="${TREND_MONTHS[index].label} ${escapeHtml(category.name)} ${formatQuantity(value)}">
                <span class="trend-bar-value">${escapeHtml(formatShortQuantity(value))}</span>
                <div class="trend-bar" style="height:${Math.max(2, value / max * 100)}%;background:${TREND_COLORS[index]}"></div>
              </div>
            `).join("")}
          </div>
          <div class="trend-category-label">${escapeHtml(category.name)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function trendCategoryDensityClass(count) {
  if (count <= 1) return "single-category";
  if (count <= 2) return "two-categories";
  if (count <= 4) return "few-categories";
  return "";
}

function topTrendCategories(monthSummaries, field, fallbackName, limit = TREND_TOP_LIMIT) {
  const totals = new Map();
  for (const month of monthSummaries) {
    for (const item of month.items) {
      const name = normalizeText(item[field]) || fallbackName;
      totals.set(name, (totals.get(name) || 0) + item.qty);
    }
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function getTrendMonthCategoryValue(monthSummaries, label, field, categoryName, fallbackName) {
  const month = monthSummaries.find((item) => item.label === label);
  if (!month) return 0;
  return month.items.reduce((total, item) => {
    const name = normalizeText(item[field]) || fallbackName;
    return name === categoryName ? total + item.qty : total;
  }, 0);
}

function renderTrendSourcePanel(monthSummaries, records) {
  const sourceEl = document.querySelector("#sourcePanel");
  if (!sourceEl) return;
  const monthLines = monthSummaries.map((item) => {
    const record = item.record;
    if (!record) return `<div>${item.label}：未引用</div>`;
    return `<div>${item.label}：${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}，${formatNumber(item.usedRows, 0)} 行，已排除最后汇总行 ${formatNumber(item.skippedSummaryRows, 0)} 行</div>`;
  });
  const dimLines = [
    ["仓库物料事业部对照表", records["dim-warehouse-material"]],
    ["仓库、金蝶、旺店通、领星", records["dim-warehouse"]],
    ["商品分类维表", records["dim-product"]]
  ].map(([label, record]) => `<div>${label}：${record ? `${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}` : "未引用"}</div>`);
  sourceEl.innerHTML = `
    <strong>趋势图口径</strong>
    <div>事实表取收发汇总表1月-4月，第4行为表头；数量取K列求和；每张表最后一行汇总数据不参与计算。</div>
    <div>事业部：事实表A列+D列+B列匹配仓库物料事业部对照表F列，取G列。</div>
    <div>产品：事实表B列匹配商品分类维表A列，取G列销售产品线。</div>
    <div>仓库位置：事实表D列匹配仓库维表B列，取H列仓库位置。</div>
    <strong>当前引用</strong>
    ${monthLines.join("")}
    ${dimLines.join("")}
  `;
}

function downloadTrendUnclassifiedRows() {
  const headers = ["月份", "缺失项", "A列", "物料编码(B列)", "物料名称(C列)", "仓库(D列)", "K列数量", "事业部", "销售产品线", "仓库位置"];
  const lines = [headers.join(",")];
  trendUnclassifiedRows.forEach((row) => {
    lines.push([
      row.month,
      row.reason,
      row.materialA,
      row.materialCode,
      row.materialName,
      row.warehouse,
      row.qty,
      row.department || "未区分",
      row.productLine || "未区分",
      row.warehouseLocation || "未分类"
    ].map(csvCell).join(","));
  });
  downloadCsv(`库存趋势未分类明细_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
}

function downloadCsv(fileName, lines) {
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function makeTrendDepartmentKey(materialA, warehouse, materialB) {
  return normalizeTrendDepartmentKey(`${materialA}${warehouse}${materialB}`);
}

function normalizeTrendDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
}

function trendToNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text || text.startsWith("#")) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function formatNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const abs = Math.abs(numeric);
  if (abs >= 10000) return `${formatNumber(numeric / 10000, 2)}万`;
  return formatNumber(numeric, 2);
}

function formatShortQuantity(value) {
  const numeric = Number(value) || 0;
  const abs = Math.abs(numeric);
  if (abs >= 10000) return `${formatNumber(numeric / 10000, 1)}万`;
  if (abs >= 1000) return formatNumber(numeric, 0);
  return formatNumber(numeric, 1);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
