const TREND_MONTHS = [
  { id: "fact-3", label: "1月" },
  { id: "fact-4", label: "2月" },
  { id: "fact-5", label: "3月" },
  { id: "fact-6", label: "4月" },
  { id: "fact-7", label: "5月" }
];

const TREND_COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de", "#ff375f"];
const TREND_TOP_LIMIT = 8;
const TREND_FILTERS = [
  { id: "warehouseTypeTrendFilter", field: "warehouseType", allLabel: "库存全链路", sortByName: true },
  { id: "departmentTrendFilter", field: "department", allLabel: "全部事业部" },
  { id: "productTrendFilter", field: "productLine", allLabel: "全部产品线" },
  { id: "seriesTrendFilter", field: "productSeries", allLabel: "全部销售系列" },
  { id: "warehouseLocationTrendFilter", field: "warehouseLocation", allLabel: "全部仓库位置" }
];
let trendUnclassifiedRows = [];
let currentTrendMonthSummaries = [];
let trendDashboardInitialized = false;

async function initTrendDashboard() {
  if (trendDashboardInitialized) return;
  if (!document.querySelector("#inventoryValueTrendChart")) return;
  trendDashboardInitialized = true;
  const statusEl = document.querySelector("#trendSummaryStatus") || document.querySelector("#summaryStatus");
  document.querySelector("#downloadTrendUnclassifiedBtn")?.addEventListener("click", downloadTrendUnclassifiedRows);
  document.querySelector("#clearTrendFiltersBtn")?.addEventListener("click", clearTrendFilters);
  document.addEventListener("click", closeTrendFilters);
  await loadSharedLibrary({ statusEl });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  renderTrendDashboard(records);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTrendDashboard);
} else {
  initTrendDashboard();
}

function renderTrendDashboard(records) {
  const maps = buildTrendDimensionMaps(records);
  const monthSummaries = TREND_MONTHS.map((month) => summarizeTrendMonth(month, records[month.id], maps));
  const loaded = monthSummaries.filter((item) => item.record).length;
  const usedRows = monthSummaries.reduce((total, item) => total + item.usedRows, 0);
  const totalQty = monthSummaries.reduce((total, item) => total + item.totalQty, 0);
  const totalValue = monthSummaries.reduce((total, item) => total + item.totalValue, 0);
  const pricedRows = monthSummaries.reduce((total, item) => total + item.pricedRows, 0);
  const directPricedRows = monthSummaries.reduce((total, item) => total + item.directPricedRows, 0);
  const fallbackPricedRows = monthSummaries.reduce((total, item) => total + item.fallbackPricedRows, 0);

  currentTrendMonthSummaries = monthSummaries;
  setTrendStatus(`已读取 ${loaded}/${TREND_MONTHS.length} 个月份文件，参与趋势计算 ${formatNumber(usedRows, 0)} 行，结算价有效 ${formatNumber(pricedRows, 0)} 行（本表P列 ${formatNumber(directPricedRows, 0)} 行，补价 ${formatNumber(fallbackPricedRows, 0)} 行），K列数量合计 ${formatQuantity(totalQty)}，K×P库存货值合计 ${formatMoneyWan(totalValue)}。`);
  populateTrendFilters(monthSummaries);
  renderTrendCharts();
  renderTrendSourcePanel(monthSummaries, records);
  trendUnclassifiedRows = monthSummaries.flatMap((item) => item.unclassifiedRows);
  renderTrendUnclassifiedRows(trendUnclassifiedRows);
}

function renderTrendCharts() {
  renderVerticalTrendChart("inventoryValueTrendChart", "inventoryValueTrendTotal", currentTrendMonthSummaries, "", "", "", "value", "库存货值");
  renderVerticalTrendChart("inventoryQtyTrendChart", "inventoryQtyTrendTotal", currentTrendMonthSummaries, "", "", "", "qty", "库存数量维度");
}

function summarizeTrendMonth(month, record, maps) {
  const sourceRows = record?.rows || [];
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const qtyAccessor = makeTrendQtyAccessor(sourceRows[0]);
  const priceAccessor = makeTrendPriceAccessor(sourceRows[0]);
  const summary = {
    ...month,
    record,
    totalRows: sourceRows.length,
    skippedSummaryRows: sourceRows.length ? 1 : 0,
    usedRows: 0,
    totalQty: 0,
    totalValue: 0,
    pricedRows: 0,
    directPricedRows: 0,
    fallbackPricedRows: 0,
    items: [],
    unclassifiedRows: []
  };

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialB = normalizeMaterialCode(nthValue(row, 2));
    const materialName = normalizeText(nthValue(row, 3));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = trendToNumber(qtyAccessor(row));
    if (!qty) continue;
    const directSettlementPrice = trendToNumber(priceAccessor(row));
    const fallbackSettlementPrice = maps.settlementPriceByMaterial.get(materialB) || 0;
    const settlementPrice = directSettlementPrice || fallbackSettlementPrice;
    const value = qty * settlementPrice;

    const department = maps.departmentByKey.get(makeTrendDepartmentKey(materialA, warehouse, materialB)) || "";
    const productLine = maps.productLineByMaterial.get(materialB) || "";
    const productSeries = maps.productSeriesByMaterial.get(materialB) || "";
    const warehouseType = maps.warehouseTypeByName.get(normalizeText(warehouse)) || "";
    const warehouseLocation = maps.warehouseLocationByName.get(normalizeText(warehouse)) || "";
    const missingReasons = [
      department ? "" : "未区分事业部",
      productLine ? "" : "未区分产品线",
      warehouseLocation ? "" : "未分类仓库位置"
    ].filter(Boolean);
    summary.usedRows += 1;
    summary.totalQty += qty;
    summary.totalValue += value;
    if (settlementPrice) summary.pricedRows += 1;
    if (directSettlementPrice) summary.directPricedRows += 1;
    else if (fallbackSettlementPrice) summary.fallbackPricedRows += 1;
    summary.items.push({
      qty,
      value,
      warehouseType: warehouseType || "未分类仓库类型",
      department: department || "未匹配事业部",
      productLine: productLine || "未分类产品线",
      productSeries: productSeries || "未分类销售系列",
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

  const warehouseTypeByName = new Map();
  const warehouseLocationByName = new Map();
  for (const row of records["dim-warehouse"]?.rows || []) {
    const warehouseName = normalizeText(nthValue(row, 2));
    const warehouseType = normalizeText(nthValue(row, 7));
    const warehouseLocation = normalizeText(nthValue(row, 8));
    if (warehouseName && warehouseType && !warehouseTypeByName.has(warehouseName)) {
      warehouseTypeByName.set(warehouseName, warehouseType);
    }
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) {
      warehouseLocationByName.set(warehouseName, warehouseLocation);
    }
  }

  const productLineByMaterial = new Map();
  const productSeriesByMaterial = new Map();
  const settlementPriceByMaterial = new Map();
  for (const row of records["dim-product"]?.rows || []) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const productLine = normalizeText(nthValue(row, 7));
    const productSeries = normalizeText(nthValue(row, 8));
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) {
      productLineByMaterial.set(materialCode, productLine);
    }
    if (materialCode && productSeries && !productSeriesByMaterial.has(materialCode)) {
      productSeriesByMaterial.set(materialCode, productSeries);
    }
    const price = trendToNumber(nthValue(row, 10));
    if (materialCode && price && !settlementPriceByMaterial.has(materialCode)) {
      settlementPriceByMaterial.set(materialCode, price);
    }
  }

  const inventoryMonthRows = records["fact-2"]?.rows || [];
  const monthPriceAccessor = makeTrendPriceAccessor(inventoryMonthRows[0]);
  for (const row of inventoryMonthRows) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const price = trendToNumber(monthPriceAccessor(row));
    if (materialCode && price) settlementPriceByMaterial.set(materialCode, price);
  }

  return { departmentByKey, warehouseTypeByName, warehouseLocationByName, productLineByMaterial, productSeriesByMaterial, settlementPriceByMaterial };
}

function populateTrendFilters(monthSummaries) {
  refreshTrendFilters(monthSummaries);
}

function refreshTrendFilters(monthSummaries = currentTrendMonthSummaries) {
  const selections = getTrendFilterSelections();
  TREND_FILTERS.forEach((filter) => {
    const select = document.querySelector(`#${filter.id}`);
    const options = linkedTrendFilterOptions(monthSummaries, filter, selections);
    const defaultLabel = options[0] || "";
    const current = (selections[filter.id] || []).filter((value) => options.includes(value));
    fillTrendFilter(select, filter.allLabel, options, defaultLabel, current);
  });
}

function fillTrendFilter(select, allLabel, values, defaultLabel = "", selectedValues = null) {
  if (!select) return;
  const allowed = new Set(values);
  const current = (selectedValues || getTrendFilterValues(select.id)).filter((value) => allowed.has(value));
  select.dataset.allLabel = allLabel;
  select.dataset.defaultLabel = defaultLabel || allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
    </button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${current.length ? "" : "checked"}>
        <span>${escapeHtml(allLabel)}</span>
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
      refreshTrendFilters();
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

function getTrendFilterSelections() {
  return Object.fromEntries(TREND_FILTERS.map((filter) => [filter.id, getTrendFilterValues(filter.id)]));
}

function linkedTrendFilterOptions(monthSummaries, filter, selections) {
  const totals = new Map();
  for (const month of monthSummaries) {
    for (const item of month.items) {
      if (!trendItemMatchesSelections(item, selections, filter.id)) continue;
      const name = normalizeText(item[filter.field]);
      if (!name) continue;
      totals.set(name, (totals.get(name) || 0) + (Number(item.qty) || 0));
    }
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => filter.sortByName ? a[0].localeCompare(b[0], "zh-CN") : b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 300)
    .map(([name]) => name);
}

function trendItemMatchesSelections(item, selections, excludedFilterId = "") {
  return TREND_FILTERS.every((filter) => {
    if (filter.id === excludedFilterId) return true;
    const selected = selections[filter.id] || [];
    if (!selected.length) return true;
    const value = normalizeText(item[filter.field]);
    return selected.includes(value);
  });
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
    buttonText.textContent = select.dataset.allLabel || "全部库存";
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
  refreshTrendFilters();
  renderTrendCharts();
}

function renderVerticalTrendChart(chartId, totalId, monthSummaries, field, fallbackName, filterId = "", metric = "qty", aggregateLabelOverride = "") {
  const container = document.querySelector(`#${chartId}`);
  if (!container) return;
  const selections = getTrendFilterSelections();
  const selected = selections[filterId] || [];
  const currentFilter = TREND_FILTERS.find((filter) => filter.id === filterId);
  const aggregateLabel = aggregateLabelOverride || getTrendAggregateLabel(currentFilter?.allLabel || "全部", selected);
  const categoryNames = [aggregateLabel];
  const total = monthSummaries.reduce((sum, month) => month.items.reduce((monthSum, item) => {
    if (!trendItemMatchesSelections(item, selections)) return monthSum;
    return monthSum + (Number(item[metric]) || 0);
  }, sum), 0);
  const formatValue = metric === "value" ? formatMoneyWan : formatQuantity;
  const formatShortValue = metric === "value" ? formatShortMoneyWan : formatShortQuantity;
  setText(`#${totalId}`, `合计 ${formatValue(total)}`);

  if (!categoryNames.length) {
    container.innerHTML = `<div class="empty">暂无趋势数据</div>`;
    return;
  }

  const valuesByCategory = categoryNames.map((name) => ({
    name,
    values: TREND_MONTHS.map((month) => getTrendMonthAggregateValue(monthSummaries, month.label, metric, selections))
  }));
  const max = Math.max(...valuesByCategory.flatMap((item) => item.values), 1);
  const orderedMonths = TREND_MONTHS.map((month) => month.label).join("、");
  container.innerHTML = `
    <div class="trend-legend">
      ${TREND_MONTHS.map((month, index) => `<span><i style="background:${TREND_COLORS[index]}"></i>${month.label}</span>`).join("")}
    </div>
    <div class="trend-bars-vertical trend-one-row ${trendCategoryDensityClass(valuesByCategory.length)}" style="--trend-month-count:${TREND_MONTHS.length}" aria-label="月份顺序：${escapeHtml(orderedMonths)}">
      ${valuesByCategory.map((category) => `
        <div class="trend-category" title="${escapeHtml(category.name)}">
          <div class="trend-bar-group">
            ${category.values.map((value, index) => `
              <div class="trend-bar-wrap" title="${TREND_MONTHS[index].label} ${escapeHtml(category.name)} ${formatValue(value)} ${formatTrendMoM(value, category.values[index - 1])}">
                <span class="trend-bar-value">${escapeHtml(formatTrendBarValue(value, category.values[index - 1], formatShortValue))}</span>
                <div class="trend-bar" style="height:${Math.max(2, value / max * 100)}%;background:${TREND_COLORS[index]}"></div>
                <span class="trend-month-label">${escapeHtml(TREND_MONTHS[index].label)}</span>
              </div>
            `).join("")}
          </div>
          <div class="trend-category-label">${escapeHtml(category.name)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function formatTrendBarValue(value, previousValue, formatter) {
  return `${formatter(value)}（${formatTrendMoM(value, previousValue)}）`;
}

function formatTrendMoM(value, previousValue) {
  const current = Number(value) || 0;
  const previous = Number(previousValue);
  if (!Number.isFinite(previous) || previous === 0) return "环比-";
  return `环比${((current / previous - 1) * 100).toFixed(1)}%`;
}

function trendCategoryDensityClass(count) {
  if (count <= 1) return "single-category";
  if (count <= 2) return "two-categories";
  if (count <= 4) return "few-categories";
  return "";
}

function topTrendCategories(monthSummaries, field, fallbackName, limit = TREND_TOP_LIMIT, metric = "qty", selections = {}, excludedFilterId = "") {
  const totals = new Map();
  for (const month of monthSummaries) {
    for (const item of month.items) {
      if (!trendItemMatchesSelections(item, selections, excludedFilterId)) continue;
      const name = normalizeText(item[field]) || fallbackName;
      totals.set(name, (totals.get(name) || 0) + (Number(item[metric]) || 0));
    }
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function getTrendMonthCategoryValue(monthSummaries, label, field, categoryName, fallbackName, metric = "qty", selections = {}, excludedFilterId = "") {
  const month = monthSummaries.find((item) => item.label === label);
  if (!month) return 0;
  return month.items.reduce((total, item) => {
    if (!trendItemMatchesSelections(item, selections, excludedFilterId)) return total;
    const name = normalizeText(item[field]) || fallbackName;
    return name === categoryName ? total + (Number(item[metric]) || 0) : total;
  }, 0);
}

function getTrendMonthAggregateValue(monthSummaries, label, metric = "qty", selections = {}, excludedFilterId = "") {
  const month = monthSummaries.find((item) => item.label === label);
  if (!month) return 0;
  return month.items.reduce((total, item) => {
    return trendItemMatchesSelections(item, selections, excludedFilterId)
      ? total + (Number(item[metric]) || 0)
      : total;
  }, 0);
}

function getTrendAggregateLabel(allLabel, selected) {
  if (!selected.length) return allLabel;
  if (selected.length === 1) return selected[0];
  return `已选${selected.length}项合计`;
}

function renderTrendSourcePanel(monthSummaries, records) {
  const sourceEl = document.querySelector("#trendSourcePanel") || (document.querySelector("#trendSummaryStatus") ? null : document.querySelector("#sourcePanel"));
  if (!sourceEl) return;
  const monthLines = monthSummaries.map((item) => {
    const record = item.record;
    if (!record) return `<div>${item.label}：未引用</div>`;
    return `<div>${item.label}：${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}，${formatNumber(item.usedRows, 0)} 行，结算价有效 ${formatNumber(item.pricedRows, 0)} 行（本表P列 ${formatNumber(item.directPricedRows, 0)} 行，补价 ${formatNumber(item.fallbackPricedRows, 0)} 行），已排除最后汇总行 ${formatNumber(item.skippedSummaryRows, 0)} 行</div>`;
  });
  const dimLines = [
    ["仓库物料事业部对照表", records["dim-warehouse-material"]],
    ["仓库、金蝶、旺店通、领星", records["dim-warehouse"]],
    ["商品分类维表", records["dim-product"]]
  ].map(([label, record]) => `<div>${label}：${record ? `${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}` : "未引用"}</div>`);
  sourceEl.innerHTML = `
    <strong>趋势图口径</strong>
    <div>事实表取收发汇总表1月-5月，第4行为表头；库存数量维度取K列数量求和；库存货值优先按本表K列数量×P列结算价(含税)计算，本表没有P列时按物料编码使用库存分析月份表的结算价(含税)补价；每张表最后一行汇总数据不参与计算。</div>
    <div>事业部：事实表A列+D列+B列匹配仓库物料事业部对照表F列，取G列。</div>
    <div>产品：事实表B列匹配商品分类维表A列，取G列销售产品线、H列销售系列。</div>
    <div>仓库位置：事实表D列匹配仓库维表B列，取H列仓库位置。</div>
    <strong>当前引用</strong>
    ${monthLines.join("")}
    ${dimLines.join("")}
  `;
}

function setTrendStatus(value) {
  const statusEl = document.querySelector("#trendSummaryStatus") || document.querySelector("#summaryStatus");
  if (statusEl) statusEl.textContent = value;
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

function makeTrendPriceAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes("结算价") && text.includes("含税"))
    || normalized.find(({ text }) => text.includes("结算价"))
    || normalized.find(({ text }) => text.includes("含税") && text.includes("价"));
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 16);
}

function makeTrendQtyAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes("结余库存数量"))
    || normalized.find(({ text }) => text.includes("结存") && text.includes("数量"))
    || normalized.find(({ text }) => text.includes("库存数量") && !text.includes("占比"))
    || normalized.find(({ text }) => text === "数量");
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 11);
}

function normalizeHeaderText(value) {
  return normalizeText(value)
    .replace(/[()\[\]（）【】\s_：:，,、-]/g, "")
    .toLowerCase();
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

function formatMoneyWan(value) {
  return `${formatNumber((Number(value) || 0) / 10000, 2)}万元`;
}

function formatShortMoneyWan(value) {
  const numeric = Number(value) || 0;
  const wan = numeric / 10000;
  const abs = Math.abs(wan);
  if (abs >= 100) return `${formatNumber(wan, 0)}万`;
  if (abs >= 10) return `${formatNumber(wan, 1)}万`;
  return `${formatNumber(wan, 2)}万`;
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
