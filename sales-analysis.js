const $ = (selector) => document.querySelector(selector);
const COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de", "#ff375f", "#5ac8fa", "#5856d6", "#30d158", "#bf5af2", "#ff6b35"];
const SALES_INVENTORY_TREND_MONTHS = [
  { id: "fact-3", label: "1月" },
  { id: "fact-4", label: "2月" },
  { id: "fact-5", label: "3月" },
  { id: "fact-6", label: "4月" },
  { id: "fact-7", label: "5月" }
];
const SALES_INVENTORY_TREND_FILTERS = [
  { id: "salesInventoryWarehouseTypeTrendFilter", field: "warehouseType", allLabel: "库存全链路" },
  { id: "salesInventoryDepartmentTrendFilter", field: "department", allLabel: "全部事业部" },
  { id: "salesInventoryProductTrendFilter", field: "productLine", allLabel: "全部产品线" },
  { id: "salesInventoryWarehouseLocationTrendFilter", field: "warehouseLocation", allLabel: "全部仓库位置" }
];
const SALES_FILTERS = [
  { id: "salesMonthFilter", field: "salesMonth", allLabel: "全部销售月份" },
  { id: "salesOrgFilter", field: "salesOrg", allLabel: "全部销售部门" },
  { id: "customerFilter", field: "productLine", allLabel: "全部销售产品线" },
  { id: "productLineFilter", field: "productSeries", allLabel: "全部销售系列" },
  { id: "materialFilter", field: "model", allLabel: "型号", limit: 300 }
];
const SALES_INVENTORY_TREND_COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de", "#ff375f"];

let salesRows = [];
let filteredRows = [];
let salesInventoryTrendSummaries = [];
let isRefreshingFilters = false;

document.addEventListener("DOMContentLoaded", async () => {
  $("#clearFiltersBtn")?.addEventListener("click", clearFilters);
  $("#downloadBtn")?.addEventListener("click", downloadCurrentRows);
  $("#clearSalesInventoryTrendFiltersBtn")?.addEventListener("click", clearSalesInventoryTrendFilters);
  $("#searchInput")?.addEventListener("input", renderSalesAnalysis);
  document.addEventListener("click", closeMultiFilters);
  SALES_FILTERS.forEach((filter) => {
    $(`#${filter.id}`)?.addEventListener("change", () => handleSalesFilterChange());
  });
  SALES_INVENTORY_TREND_FILTERS.forEach((filter) => {
    $(`#${filter.id}`)?.addEventListener("change", () => handleSalesInventoryTrendFilterChange());
  });
  await refreshSalesAnalysis();
});

async function refreshSalesAnalysis() {
  await loadSharedLibrary({ statusEl: $("#salesStatus") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const salesRecord = records["sales-data"];
  const productMap = mapProducts(records["dim-product"]?.rows || []);
  const salesDepartmentMap = mapSalesDepartments(records["dim-store-name"]?.rows || []);
  const storeMap = mapStoreInfo(records["dim-customer-material"]);
  renderSourcePanel(salesRecord, records);
  renderSalesInventoryTrendDashboard(records);
  if (!salesRecord) {
    salesRows = [];
    $("#salesStatus").textContent = "缺少销售数据文件，请先到销售数据文件页面上传并应用。";
    populateFilters([]);
    renderSalesAnalysis();
    return;
  }

  salesRows = (salesRecord.rows || []).map((row) => {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row);
    const product = productMap.get(materialCode) || {};
    const model = product.model || "";
    const qty = getSalesReceivableQty(row);
    const storeInfo = storeMap.get(normalizeStoreNameForSales(customer)) || null;
    const salesDepartmentKey = getSalesDepartmentKey(row);
    return {
      salesMonth: getSalesMonth(row),
      salesOrg: salesDepartmentMap.get(salesDepartmentKey) || "",
      customer,
      storeShortName: storeInfo?.shortName || customer,
      salesDepartmentKey,
      materialCode,
      model,
      materialName: getSalesMaterialName(row) || product.materialName || "",
      productLine: product.productLine || "",
      productSeries: product.productSeries || "",
      qty,
      storeMatchStatus: storeInfo ? "已匹配" : "未匹配"
    };
  }).filter((row) => row.customer || row.materialCode || row.model || row.qty);

  populateFilters(salesRows);
  $("#salesStatus").textContent = buildStatusText(salesRecord, salesRows);
  renderSalesAnalysis();
}

function populateFilters(rows) {
  refreshSalesFilterOptions(rows);
}

function handleSalesFilterChange() {
  if (isRefreshingFilters) return;
  refreshSalesFilterOptions(salesRows);
  renderSalesAnalysis();
}

function refreshSalesFilterOptions(rows = salesRows) {
  const selections = getFilterSelections(SALES_FILTERS);
  isRefreshingFilters = true;
  SALES_FILTERS.forEach((filter) => {
    const options = linkedFilterOptions(rows, SALES_FILTERS, filter, selections, filter.limit);
    const current = (selections[filter.id] || []).filter((value) => options.includes(value));
    fillSelect($(`#${filter.id}`), filter.allLabel, options, current);
  });
  isRefreshingFilters = false;
}

function renderSalesAnalysis() {
  const search = normalizeText($("#searchInput")?.value || "").toLowerCase();
  const selections = getFilterSelections(SALES_FILTERS);
  filteredRows = salesRows.filter((row) => {
    if (!rowMatchesSelections(row, SALES_FILTERS, selections)) return false;
    if (search) {
      const haystack = [row.customer, row.storeShortName, row.model, row.materialCode, row.materialName, row.salesOrg].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  renderMetrics(filteredRows);
  renderBars("customerQtyChart", groupSum(filteredRows, "salesOrg", 10), "customerQtyTotal");
  renderBars("salesOrgQtyChart", groupSum(filteredRows, "storeShortName", 10), "salesOrgQtyTotal");
  renderBars("productLineQtyChart", groupSum(filteredRows, "productLine", 10), "productLineQtyTotal");
  renderBars("materialQtyChart", groupSum(filteredRows, "productSeries", 10), "materialQtyTotal");
  renderBars("storeMatchQtyChart", groupSum(filteredRows, "model", 10), "storeMatchQtyTotal");
  renderTable(filteredRows);
}

function renderMetrics(rows) {
  $("#salesQtyTotal").textContent = formatQuantity(sum(rows, "qty"));
  $("#customerTotal").textContent = formatNumber(uniqueValues(rows, "customer").length, 0);
}

function renderTable(rows) {
  const tbody = $("#salesRows");
  if (!tbody) return;
  const visible = rows.slice(0, 300);
  tbody.innerHTML = visible.length ? visible.map((row) => `
    <tr>
      <td>${escapeHtml(row.salesMonth)}</td>
      <td>${escapeHtml(row.salesOrg)}</td>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td>${escapeHtml(row.productSeries)}</td>
      <td class="num">${formatQuantity(row.qty)}</td>
      <td>${escapeHtml(row.storeMatchStatus)}</td>
    </tr>
  `).join("") : `<tr><td colspan="9" class="empty">暂无数据</td></tr>`;
}

function renderBars(id, rows, totalId = "") {
  const container = $(`#${id}`);
  if (!container) return;
  const total = rows.reduce((sumValue, row) => sumValue + row.value, 0);
  const totalEl = totalId ? $(`#${totalId}`) : null;
  if (totalEl) totalEl.textContent = `合计 ${formatQuantity(total)}`;
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row, index) => {
    const width = Math.max(2, row.value / max * 100);
    const valueText = `${formatQuantity(row.value)}（${formatPercent(row.value, total)}）`;
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(valueText)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }).join("");
}

function groupSum(rows, key, limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || "未分类";
    map.set(name, (map.get(name) || 0) + (Number(row.qty) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, limit);
}

function renderSalesInventoryTrendDashboard(records) {
  if (!$("#salesInventoryValueTrendChart")) return;
  const maps = buildSalesInventoryTrendMaps(records);
  salesInventoryTrendSummaries = SALES_INVENTORY_TREND_MONTHS.map((month) => summarizeSalesInventoryTrendMonth(month, records[month.id], maps));
  const loaded = salesInventoryTrendSummaries.filter((item) => item.record).length;
  const usedRows = salesInventoryTrendSummaries.reduce((total, item) => total + item.usedRows, 0);
  const totalValue = salesInventoryTrendSummaries.reduce((total, item) => total + item.totalValue, 0);
  setText("#salesInventoryTrendStatus", `已读取 ${loaded}/${SALES_INVENTORY_TREND_MONTHS.length} 个月份文件，参与趋势计算 ${formatNumber(usedRows, 0)} 行，库存占用合计 ${formatSalesInventoryTrendMoneyWan(totalValue)}。`);
  populateSalesInventoryTrendFilters(salesInventoryTrendSummaries);
  renderSalesInventoryTrend();
}

function buildSalesInventoryTrendMaps(records) {
  const departmentByKey = new Map();
  for (const row of records["dim-warehouse-material"]?.rows || []) {
    const key = normalizeSalesInventoryTrendKey(nthValue(row, 6));
    const department = normalizeText(nthValue(row, 7));
    if (key && department && !departmentByKey.has(key)) departmentByKey.set(key, department);
  }

  const warehouseTypeByName = new Map();
  const warehouseLocationByName = new Map();
  for (const row of records["dim-warehouse"]?.rows || []) {
    const warehouseName = normalizeText(nthValue(row, 2));
    const warehouseType = normalizeText(nthValue(row, 7));
    const warehouseLocation = normalizeText(nthValue(row, 8));
    if (warehouseName && warehouseType && !warehouseTypeByName.has(warehouseName)) warehouseTypeByName.set(warehouseName, warehouseType);
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) warehouseLocationByName.set(warehouseName, warehouseLocation);
  }

  const productLineByMaterial = new Map();
  const settlementPriceByMaterial = new Map();
  for (const row of records["dim-product"]?.rows || []) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const productLine = normalizeText(nthValue(row, 7));
    const price = firstNumber([
      firstValue(row, ["结算价（含税）", "结算价(含税)", "结算价含税", "结算价"]),
      firstValueByHeaderIncludes(row, ["结算价"]),
      nthValue(row, 10)
    ]);
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) productLineByMaterial.set(materialCode, productLine);
    if (materialCode && price && !settlementPriceByMaterial.has(materialCode)) settlementPriceByMaterial.set(materialCode, price);
  }

  const inventoryMonthRows = records["fact-2"]?.rows || [];
  const monthPriceAccessor = makeSalesInventoryTrendPriceAccessor(inventoryMonthRows[0]);
  for (const row of inventoryMonthRows) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const price = firstNumber([monthPriceAccessor(row)]);
    if (materialCode && price) settlementPriceByMaterial.set(materialCode, price);
  }

  return { departmentByKey, warehouseTypeByName, warehouseLocationByName, productLineByMaterial, settlementPriceByMaterial };
}

function summarizeSalesInventoryTrendMonth(month, record, maps) {
  const sourceRows = record?.rows || [];
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const qtyAccessor = makeSalesInventoryTrendQtyAccessor(sourceRows[0]);
  const priceAccessor = makeSalesInventoryTrendPriceAccessor(sourceRows[0]);
  const summary = {
    ...month,
    record,
    usedRows: 0,
    totalValue: 0,
    items: []
  };

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialCode = normalizeMaterialCode(nthValue(row, 2));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = firstNumber([qtyAccessor(row)]);
    if (!qty) continue;
    const directPrice = firstNumber([priceAccessor(row)]);
    const settlementPrice = directPrice || maps.settlementPriceByMaterial.get(materialCode) || 0;
    const value = qty * settlementPrice;
    const department = maps.departmentByKey.get(normalizeSalesInventoryTrendKey(`${materialA}${warehouse}${materialCode}`)) || "未匹配事业部";
    const warehouseType = maps.warehouseTypeByName.get(warehouse) || "未分类仓库类型";
    const warehouseLocation = maps.warehouseLocationByName.get(warehouse) || "未分类仓库位置";
    const productLine = maps.productLineByMaterial.get(materialCode) || "未分类产品线";
    summary.usedRows += 1;
    summary.totalValue += value;
    summary.items.push({ value, warehouseType, department, productLine, warehouseLocation });
  }
  return summary;
}

function populateSalesInventoryTrendFilters(monthSummaries) {
  refreshSalesInventoryTrendFilterOptions(monthSummaries);
}

function handleSalesInventoryTrendFilterChange() {
  if (isRefreshingFilters) return;
  refreshSalesInventoryTrendFilterOptions();
  renderSalesInventoryTrend();
}

function refreshSalesInventoryTrendFilterOptions(monthSummaries = salesInventoryTrendSummaries) {
  const items = monthSummaries.flatMap((month) => month.items || []);
  const selections = getFilterSelections(SALES_INVENTORY_TREND_FILTERS);
  isRefreshingFilters = true;
  SALES_INVENTORY_TREND_FILTERS.forEach((filter) => {
    const options = linkedFilterOptions(items, SALES_INVENTORY_TREND_FILTERS, filter, selections, 300, "value");
    const current = (selections[filter.id] || []).filter((value) => options.includes(value));
    fillSelect($(`#${filter.id}`), filter.allLabel, options, current);
  });
  isRefreshingFilters = false;
}

function linkedFilterOptions(rows, filters, targetFilter, selections, limit = 300, sortValueField = "") {
  const totals = new Map();
  for (const row of rows) {
    if (!rowMatchesSelections(row, filters, selections, targetFilter.id)) continue;
    const name = normalizeText(row[targetFilter.field]);
    if (!name) continue;
    const sortValue = sortValueField ? Number(row[sortValueField]) || 0 : 1;
    totals.set(name, (totals.get(name) || 0) + sortValue);
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit || 300)
    .map(([name]) => name);
}

function getFilterSelections(filters) {
  return Object.fromEntries(filters.map((filter) => [filter.id, getSelectValues($(`#${filter.id}`))]));
}

function rowMatchesFilters(row, filters, excludedFilterId = "") {
  return rowMatchesSelections(row, filters, getFilterSelections(filters), excludedFilterId);
}

function rowMatchesSelections(row, filters, selections, excludedFilterId = "") {
  return filters.every((filter) => {
    if (filter.id === excludedFilterId) return true;
    const selected = selections[filter.id] || [];
    if (!selected.length) return true;
    return selected.includes(normalizeText(row[filter.field]));
  });
}

function renderSalesInventoryTrend() {
  refreshSalesInventoryTrendFilterOptions();
  const selections = getSalesInventoryTrendSelections();
  const values = SALES_INVENTORY_TREND_MONTHS.map((month) => {
    const summary = salesInventoryTrendSummaries.find((item) => item.label === month.label);
    if (!summary) return 0;
    return summary.items.reduce((total, item) => {
      return salesInventoryTrendItemMatches(item, selections) ? total + (Number(item.value) || 0) : total;
    }, 0);
  });
  const total = values.reduce((sumValue, value) => sumValue + value, 0);
  setText("#salesInventoryValueTrendTotal", `合计 ${formatSalesInventoryTrendMoneyWan(total)}`);
  renderSalesInventoryVerticalTrendChart(values, selections);
}

function renderSalesInventoryVerticalTrendChart(values, selections) {
  const container = $("#salesInventoryValueTrendChart");
  if (!container) return;
  const max = Math.max(...values, 1);
  const label = getSalesInventoryTrendAggregateLabel(selections);
  container.innerHTML = `
    <div class="trend-legend">
      ${SALES_INVENTORY_TREND_MONTHS.map((month, index) => `<span><i style="background:${SALES_INVENTORY_TREND_COLORS[index]}"></i>${month.label}</span>`).join("")}
    </div>
    <div class="trend-bars-vertical trend-one-row single-category" style="--trend-month-count:${SALES_INVENTORY_TREND_MONTHS.length}" aria-label="月份顺序：1月、2月、3月、4月、5月">
      <div class="trend-category" title="${escapeHtml(label)}">
        <div class="trend-bar-group">
          ${values.map((value, index) => `
            <div class="trend-bar-wrap" title="${SALES_INVENTORY_TREND_MONTHS[index].label} ${escapeHtml(formatSalesInventoryTrendMoneyWan(value))} ${escapeHtml(formatSalesInventoryTrendMoM(value, values[index - 1]))}">
              <span class="trend-bar-value">${escapeHtml(formatSalesInventoryTrendBarValue(value, values[index - 1]))}</span>
              <div class="trend-bar" style="height:${Math.max(2, value / max * 100)}%;background:${SALES_INVENTORY_TREND_COLORS[index]}"></div>
              <span class="trend-month-label">${SALES_INVENTORY_TREND_MONTHS[index].label}</span>
            </div>
          `).join("")}
        </div>
        <div class="trend-category-label">${escapeHtml(label)}</div>
      </div>
    </div>
  `;
}

function getSalesInventoryTrendSelections() {
  return Object.fromEntries(SALES_INVENTORY_TREND_FILTERS.map((filter) => [filter.id, getSelectValues($(`#${filter.id}`))]));
}

function salesInventoryTrendItemMatches(item, selections) {
  return rowMatchesSelections(item, SALES_INVENTORY_TREND_FILTERS, selections);
}

function clearSalesInventoryTrendFilters() {
  SALES_INVENTORY_TREND_FILTERS.forEach((filter) => clearSelect($(`#${filter.id}`)));
  refreshSalesInventoryTrendFilterOptions();
  renderSalesInventoryTrend();
}

function getSalesInventoryTrendAggregateLabel(selections) {
  const selected = SALES_INVENTORY_TREND_FILTERS.flatMap((filter) => selections[filter.id] || []);
  if (!selected.length) return "全部库存占用";
  if (selected.length === 1) return selected[0];
  return `已选${selected.length}项合计`;
}

function makeSalesInventoryTrendQtyAccessor(sampleRow) {
  const key = findHeaderKey(sampleRow, ["结余库存数量", "库存数量", "结存数量", "数量"]);
  return key ? (row) => row?.[key] : (row) => nthValue(row, 11);
}

function makeSalesInventoryTrendPriceAccessor(sampleRow) {
  const key = findHeaderKey(sampleRow, ["结算价(含税)", "结算价（含税）", "结算价含税", "结算价"]);
  return key ? (row) => row?.[key] : (row) => nthValue(row, 16);
}

function findHeaderKey(row, candidates) {
  const keys = Object.keys(row || {});
  const normalizedCandidates = candidates.map(normalizeCompactHeader);
  return keys.find((key) => normalizedCandidates.includes(normalizeCompactHeader(key)))
    || keys.find((key) => normalizedCandidates.some((candidate) => normalizeCompactHeader(key).includes(candidate)));
}

function normalizeCompactHeader(value) {
  return normalizeText(value).replace(/[()\[\]（）【】\s_：:，,、-]/g, "").toLowerCase();
}

function normalizeSalesInventoryTrendKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
}

function formatSalesInventoryTrendBarValue(value, previousValue) {
  return `${formatSalesInventoryTrendShortMoneyWan(value)}（${formatSalesInventoryTrendMoM(value, previousValue)}）`;
}

function formatSalesInventoryTrendMoM(value, previousValue) {
  const current = Number(value) || 0;
  const previous = Number(previousValue);
  if (!Number.isFinite(previous) || previous === 0) return "环比-";
  return `环比${((current / previous - 1) * 100).toFixed(1)}%`;
}

function formatSalesInventoryTrendMoneyWan(value) {
  return `${formatNumber((Number(value) || 0) / 10000, 2)}万元`;
}

function formatSalesInventoryTrendShortMoneyWan(value) {
  const wan = (Number(value) || 0) / 10000;
  const abs = Math.abs(wan);
  if (abs >= 100) return `${formatNumber(wan, 0)}万`;
  if (abs >= 10) return `${formatNumber(wan, 1)}万`;
  return `${formatNumber(wan, 2)}万`;
}

function clearFilters() {
  SALES_FILTERS.forEach((filter) => clearSelect($(`#${filter.id}`)));
  if ($("#searchInput")) $("#searchInput").value = "";
  refreshSalesFilterOptions();
  renderSalesAnalysis();
}

function fillSelect(select, allLabel, values, selectedValuesOverride = null) {
  if (!select) return;
  const current = getSelectValues(select);
  const selectedSource = Array.isArray(selectedValuesOverride) ? selectedValuesOverride : current;
  const selectedValues = values.filter((value) => selectedSource.includes(value));
  select.dataset.allLabel = allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false"><span></span></button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${selectedValues.length ? "" : "checked"}>
        <span>全部</span>
      </label>
      ${values.map((value) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(value)}" ${selectedValues.includes(value) ? "checked" : ""}>
          <span>${escapeHtml(value)}</span>
        </label>
      `).join("")}
    </div>
  `;
  select.querySelector(".multi-filter-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMultiFilter(select);
  });
  select.querySelector(".multi-filter-menu")?.addEventListener("click", (event) => event.stopPropagation());
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncMultiFilterSelection(select, checkbox);
      updateMultiFilterLabel(select);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  updateMultiFilterLabel(select);
}

function clearSelect(select) {
  if (!select) return;
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checkbox.dataset.all === "true";
  });
  updateMultiFilterLabel(select);
}

function getSelectValues(select) {
  if (!select) return [];
  return [...select.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function matchesFilter(value, select) {
  const selected = getSelectValues(select);
  return !selected.length || selected.includes(normalizeText(value));
}

function syncMultiFilterSelection(select, changedCheckbox) {
  const allCheckbox = select.querySelector("input[data-all='true']");
  const itemCheckboxes = [...select.querySelectorAll("input[type='checkbox']:not([data-all='true'])")];
  if (changedCheckbox.dataset.all === "true") {
    if (changedCheckbox.checked) itemCheckboxes.forEach((checkbox) => { checkbox.checked = false; });
    else if (!itemCheckboxes.some((checkbox) => checkbox.checked)) changedCheckbox.checked = true;
    return;
  }
  if (changedCheckbox.checked && allCheckbox) allCheckbox.checked = false;
  if (!itemCheckboxes.some((checkbox) => checkbox.checked) && allCheckbox) allCheckbox.checked = true;
}

function updateMultiFilterLabel(select) {
  const buttonText = select.querySelector(".multi-filter-button span");
  const values = getSelectValues(select);
  const allLabel = select.dataset.allLabel || "全部";
  if (!buttonText) return;
  if (!values.length) buttonText.textContent = allLabel;
  else if (values.length === 1) buttonText.textContent = values[0];
  else if (values.length === 2) buttonText.textContent = values.join("、");
  else buttonText.textContent = `已选${values.length}项`;
}

function toggleMultiFilter(select) {
  const willOpen = !select.classList.contains("open");
  closeMultiFilters();
  select.classList.toggle("open", willOpen);
  select.querySelector(".multi-filter-button")?.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function closeMultiFilters(event) {
  if (event?.target?.closest?.(".multi-filter")) return;
  document.querySelectorAll(".multi-filter.open").forEach((select) => {
    select.classList.remove("open");
    select.querySelector(".multi-filter-button")?.setAttribute("aria-expanded", "false");
  });
}

function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ["物料编码"]), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      model: normalizeText(nthValue(row, 16)),
      materialName: normalizeText(firstText([firstValue(row, ["金蝶名称", "物料名称", "货品名称"]), nthValue(row, 4)])),
      productLine: normalizeText(firstText([firstValue(row, ["销售产品线", "产品线"]), nthValue(row, 7)])),
      productSeries: normalizeText(firstText([firstValue(row, ["销售系列", "产品系列", "系列"]), nthValue(row, 8)]))
    });
  }
  return map;
}

function getSalesMonth(row) {
  const rawValue = firstText([
    firstValue(row, ["销售月份", "月份", "销售月", "出库月份"]),
    firstValue(row, ["销售日期", "出库日期", "单据日期", "审核日期", "日期"]),
    firstValueByHeaderIncludes(row, ["月份"])
  ]);
  return formatSalesMonth(rawValue);
}

function mapStoreInfo(record) {
  const rows = record?.rows || [];
  const map = new Map();
  for (const row of rows) {
    const rawName = firstText([
      nthValue(row, 2),
      firstValue(row, ["金蝶名称", "客户名称", "店铺名称", "店铺", "公司名称", "全称"])
    ]);
    const normalized = normalizeStoreNameForSales(rawName);
    if (!normalized || map.has(normalized)) continue;
    const shortName = firstText([
      firstValue(row, ["日常汇报沟通简称", "日常沟通简称", "汇报简称", "店铺简称", "简称"]),
      firstValueByHeaderIncludes(row, ["日常", "简称"]),
      firstValueByHeaderIncludes(row, ["汇报", "简称"]),
      firstValueByHeaderIncludes(row, ["简称"]),
      nthValue(row, 4),
      nthValue(row, 3),
      rawName
    ]);
    map.set(normalized, {
      rawName,
      shortName: normalizeText(shortName) || rawName
    });
  }
  return map;
}

function mapSalesDepartments(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeSalesDepartmentKey(firstText([
      firstValue(row, ["匹配键", "客户物料匹配键", "客户物料编码", "客户物料", "型号"]),
      nthValue(row, 4)
    ]));
    const department = normalizeText(firstText([
      firstValue(row, ["销售部门", "部门", "事业部", "销售组织"]),
      nthValue(row, 5)
    ]));
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

function getSalesDepartmentKey(row) {
  return normalizeSalesDepartmentKey(firstText([
    firstValue(row, ["客户物料编码", "客户物料", "型号", "销售部门匹配键"]),
    nthValue(row, 12)
  ]));
}

function getSalesCustomerName(row) {
  return normalizeText(firstText([
    firstValue(row, ["客户名称", "客户", "店铺名称", "店铺"]),
    nthValue(row, 2)
  ]));
}

function getSalesMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ["物料编码", "货品编码", "商品编码", "产品编码", "SKU", "MSKU"]),
    firstValueByHeaderIncludes(row, ["物料", "编码"]),
    nthValue(row, 3)
  ]));
}

function getSalesMaterialName(row) {
  return normalizeText(firstText([
    firstValue(row, ["物料名称", "货品名称", "商品名称", "产品名称", "金蝶名称", "品名"]),
    firstValueByHeaderIncludes(row, ["物料", "名称"])
  ]));
}

function getSalesReceivableQty(row) {
  const value = firstNumber([
    firstValue(row, ["应收数量", "销售数量", "数量", "出库数量"]),
    nthValue(row, 9)
  ]);
  return value;
}

function formatSalesMonth(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const excelSerial = Number(text);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 80000) {
    const date = new Date(Math.round((excelSerial - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const matched = text.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])/);
  if (matched) return `${matched[1]}-${String(Number(matched[2])).padStart(2, "0")}`;
  return text;
}

function firstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return "";
}

function firstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    const value = toNumber(candidate);
    if (value !== 0 || text === "0") return value;
  }
  return 0;
}

function normalizeStoreNameForSales(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[&＆]/g, "")
    .replace(/[()（）【】\[\]{}<>《》]/g, "")
    .replace(/[，,。.、；;：:\-_\s]/g, "")
    .toLowerCase();
}

function normalizeSalesDepartmentKey(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatPercent(value, total) {
  const denominator = Number(total) || 0;
  if (!denominator) return "0.00%";
  return `${((Number(value) || 0) / denominator * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function setText(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value;
}

function buildStatusText(record, rows) {
  const appliedAt = record?.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  return `已读取 ${formatNumber(rows.length, 0)} 行销售数据；当前引用：${record?.fileName || "-"}（${appliedAt}）`;
}

function renderSourcePanel(record, records) {
  const panel = $("#sourcePanel");
  if (!panel) return;
  const salesRef = record ? `${record.fileName || "-"}；当前引用：${formatRecordTime(record.appliedAt || record.savedAt)}` : "未引用";
  const productRef = records["dim-product"] ? `${records["dim-product"].fileName || "-"}；${formatRecordTime(records["dim-product"].appliedAt || records["dim-product"].savedAt)}` : "未引用";
  const customerMaterialRef = records["dim-store-name"] ? `${records["dim-store-name"].fileName || "-"}；${formatRecordTime(records["dim-store-name"].appliedAt || records["dim-store-name"].savedAt)}` : "未引用";
  const storeRef = records["dim-customer-material"] ? `${records["dim-customer-material"].fileName || "-"}；${formatRecordTime(records["dim-customer-material"].appliedAt || records["dim-customer-material"].savedAt)}` : "未引用";
  panel.innerHTML = `
    <div><strong>销售数据文件</strong>：${escapeHtml(salesRef)}</div>
    <div><strong>商品分类维表</strong>：${escapeHtml(productRef)}</div>
    <div><strong>客户与物料对照表</strong>：${escapeHtml(customerMaterialRef)}；销售数据文件 L列匹配维表 D列，取维表 E列作为销售部门</div>
    <div><strong>店铺名称汇总（金蝶&领星&简称）</strong>：${escapeHtml(storeRef)}</div>
  `;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function downloadCurrentRows() {
  const header = ["销售月份", "销售部门", "客户名称", "型号", "物料名称", "销售产品线", "销售系列", "应收数量", "店铺名称汇总匹配"];
  const lines = [header, ...filteredRows.map((row) => [
    row.salesMonth,
    row.salesOrg,
    row.customer,
    row.model,
    row.materialName,
    row.productLine,
    row.productSeries,
    row.qty,
    row.storeMatchStatus
  ])].map((line) => line.map(csvCell).join(","));
  downloadCsv(`销售数据分析_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(fileName, lines) {
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
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
