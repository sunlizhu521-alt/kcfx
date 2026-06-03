const $ = (selector) => document.querySelector(selector);
const DEPARTMENT_ORDER = [
  "海外事业一部",
  "海外事业二部",
  "国内事业部",
  "全球招商部",
  "瑞朗德销售部",
  "瑞朗德工厂",
  "电子车间",
  "宁波工厂",
  "试制中心",
  "售后配件仓",
  "委外仓",
  "系统集成仓",
  "封样仓",
  "供应商仓（后续划分事业部）"
];
const COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de", "#ff375f", "#5ac8fa", "#5856d6", "#30d158", "#bf5af2", "#ff6b35", "#64d2ff", "#8e8e93"];
const WAREHOUSE_TYPE_CARDS = ["生产材料仓", "生成成品仓", "销售成品仓", "销售退货仓", "销售拆检仓", "销售配件仓"];
const AGE_BUCKETS = ["0-30天", "31-60天", "61-90天", "91-120天", "120天以上"];
const AGE_BUCKET_DEFINITIONS = [
  { label: "0-30天", candidates: ["0-30天数量", "0-30天库存数量", "0-30天结余库存数量", "0-30天库龄数量", "0-30天"] },
  { label: "31-60天", candidates: ["31-60天数量", "31-60天库存数量", "31-60天结余库存数量", "31-60天库龄数量", "31-60天"] },
  { label: "61-90天", candidates: ["61-90天数量", "61-90天库存数量", "61-90天结余库存数量", "61-90天库龄数量", "61-90天"] },
  { label: "91-120天", candidates: ["91-120天数量", "91-120天库存数量", "91-120天结余库存数量", "91-120天库龄数量", "91-120天"] },
  { label: "120天以上", candidates: ["120天以上数量", "120天以上库存数量", "120天以上结余库存数量", "120天以上库龄数量", "120天及以上数量", "120天及以上库存数量", "120以上数量", "120天以上", "120天及以上", "120以上"] }
];
let summaryRows = [];
let filteredRows = [];
let departmentMatchDiagnostics = { matched: 0, unmatched: 0, sample: "" };
let closedInventoryValue = 0;

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", clearFilters);
  $("#downloadBtn").addEventListener("click", downloadCurrentRows);
  $("#downloadTurnoverBtn").addEventListener("click", downloadTurnoverSummary);
  $("#downloadProductLineBtn").addEventListener("click", downloadProductLineSummary);
  $("#downloadSeriesBtn").addEventListener("click", downloadSeriesSummary);
  $("#downloadUnclassifiedBtn").addEventListener("click", downloadUnclassifiedRows);
  document.addEventListener("click", closeMultiFilters);
  $("#searchInput").addEventListener("input", renderSummary);
  $("#productLineFilter").addEventListener("change", () => {
    populateSeriesFilter(summaryRows);
    renderSummary();
  });
  ["warehouseTypeFilter", "departmentFilter", "seriesFilter", "ageFilter", "warehouseLocationFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("change", renderSummary);
  });
  await refreshSummary();
});

async function refreshSummary() {
  await loadSharedLibrary({ statusEl: $("#summaryStatus") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const inventoryRecord = records["fact-inventory"];
  const detailRecord = records["fact-2"];
  const productRecord = records["dim-product"];
  const warehouseRecord = records["dim-warehouse"];
  const warehouseMaterialRecord = records["dim-warehouse-material"];
  renderSourcePanel(detailRecord, []);
  if (!detailRecord) {
    summaryRows = [];
    $("#summaryStatus").textContent = "缺少收发明细汇总表，请先到备货事实表库上传并应用。";
    populateFilters([]);
    renderSummary();
    return;
  }

  renderClosedInventoryMetrics(inventoryRecord);
  const warehouseMap = mapWarehousesByName(warehouseRecord?.rows || []);
  const productMap = mapProductsByMaterialCode(productRecord?.rows || []);
  const warehouseMaterialMaps = mapWarehouseMaterialDimensions(warehouseMaterialRecord?.rows || []);
  departmentMatchDiagnostics = { matched: 0, unmatched: 0, sample: "" };
  summaryRows = (detailRecord.rows || []).map((row) => {
    const materialCode = getDetailMaterialCode(row);
    const warehouse = getDetailWarehouse(row);
    const organization = getDetailOrganization(row);
    const materialName = getDetailMaterialName(row);
    const endingQty = getDetailEndingQty(row);
    const inventoryDays = getDetailInventoryDays(row);
    const settlementPrice = getDetailSettlementPrice(row);
    const pmcType = getPmcInventoryType(row);
    const pmcBasis = getPmcBasis(row);
    const pmcReason = getPmcReason(row);
    const ageQuantities = getAgeQuantities(row);
    const ageSettlementAmounts = Object.fromEntries(
      Object.entries(ageQuantities).map(([label, qty]) => [label, qty * settlementPrice])
    );
    const warehouseInfo = warehouseMap.get(warehouse) || {};
    const department = lookupDepartment(warehouseMaterialMaps, row) || getDetailDepartment(row);
    recordDepartmentMatch(department, row);
    const product = productMap.get(materialCode) || {};
    return {
      materialCode,
      materialName,
      department,
      productLine: getDetailProductLine(row) || product.productLine || "",
      series: getDetailSeries(row) || product.series || "",
      warehouseType: warehouseInfo.warehouseType || "",
      warehouseLocation: warehouseInfo.warehouseLocation || "",
      warehouse,
      organization,
      inventoryDays,
      pmcType,
      pmcBasis,
      pmcReason,
      ageQuantities,
      ageSettlementAmounts,
      ageQuantityTotal: sumObjectValues(ageQuantities),
      ageSettlementAmount: sumObjectValues(ageSettlementAmounts),
      endingQty,
      settlementPrice,
      settlementAmount: endingQty * settlementPrice
    };
  });
  populateFilters(summaryRows, records);
  renderSourcePanel(detailRecord, summaryRows);
  const diagnostic = departmentMatchDiagnostics.sample ? `，未匹配样例 ${departmentMatchDiagnostics.sample}` : "";
  $("#summaryStatus").textContent = buildSummaryStatus(summaryRows.length, departmentMatchDiagnostics.matched, diagnostic, records);
  renderSummary();
}

function clearFilters() {
  clearSelect($("#warehouseTypeFilter"));
  clearSelect($("#departmentFilter"));
  clearSelect($("#productLineFilter"));
  populateSeriesFilter(summaryRows);
  clearSelect($("#seriesFilter"));
  clearSelect($("#ageFilter"));
  clearSelect($("#warehouseLocationFilter"));
  $("#searchInput").value = "";
  renderSummary();
}

function renderClosedInventoryMetrics(record) {
  const rows = record?.rows || [];
  const qty = rows.reduce((total, row) => total + getClosedInventoryQty(row), 0);
  const value = rows.reduce((total, row) => total + getClosedInventoryValue(row), 0);
  closedInventoryValue = value;
  $("#closedInventoryQtyTotal").textContent = formatNumberWithYi(qty, 3);
  $("#closedInventoryValueTotal").textContent = formatMoneyWithYi(value);
}

function buildSummaryStatus(rowCount, matchedCount, diagnostic, records) {
  const refs = [
    ["收发明细汇总表", records["fact-2"]],
    ["关账后库存事实表", records["fact-inventory"]],
    ["商品分类维表", records["dim-product"]],
    ["仓库维表", records["dim-warehouse"]],
    ["仓库物料事业部对照表", records["dim-warehouse-material"]]
  ].map(([label, record]) => formatStatusRecord(label, record)).filter(Boolean);
  return `已读取 ${formatNumber(rowCount, 0)} 行，事业部匹配 ${formatNumber(matchedCount, 0)} 行${diagnostic}；引用文件：${refs.join("；")}`;
}

function formatStatusRecord(label, record) {
  if (!record) return `${label}：未引用`;
  const updatedAt = formatRecordTime(record.appliedAt || record.savedAt);
  return `${label}：${record.fileName || "-"}（${updatedAt}）`;
}

function renderSourcePanel(record, rows = []) {
  if (!record) {
    $("#sourcePanel").innerHTML = "";
    return;
  }
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const reminder = buildSourceReminder(rows);
  $("#sourcePanel").innerHTML = `
    <div><strong>收发明细汇总表</strong>：${escapeHtml(record.fileName || "-")}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>IndexedDB: ${KC_DB_NAME}/${KC_STORE}/fact-2</code></div>
    <div class="source-reminder">${escapeHtml(reminder)}</div>
  `;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function buildSourceReminder(rows) {
  if (!rows.length) return "提醒：文件读取后会提示有库存数量没有结算价、有库存没有分到事业部等信息。";
  const stockRows = rows.filter((row) => Number(row.endingQty) !== 0);
  const missingSettlement = stockRows.filter((row) => !(Number(row.settlementPrice) > 0)).length;
  const missingDepartment = stockRows.filter((row) => !normalizeText(row.department)).length;
  const missingProductLine = stockRows.filter((row) => !normalizeText(row.productLine)).length;
  const missingWarehouseLocation = stockRows.filter((row) => !normalizeText(row.warehouseLocation)).length;
  return [
    `提醒：有库存行 ${formatNumber(stockRows.length, 0)} 行`,
    `有库存数量没有结算价 ${formatNumber(missingSettlement, 0)} 行`,
    `有库存没有分到事业部 ${formatNumber(missingDepartment, 0)} 行`,
    `有库存没有销售产品线 ${formatNumber(missingProductLine, 0)} 行`,
    `有库存没有仓库位置 ${formatNumber(missingWarehouseLocation, 0)} 行`
  ].join("；");
}

function populateFilters(rows, records = null) {
  const warehouseMaterialRows = records?.["dim-warehouse-material"]?.rows || [];
  fillSelect($("#warehouseTypeFilter"), "全部仓库类型", uniqueValues(rows, "warehouseType"));
  fillSelect($("#departmentFilter"), "全部事业部", sortByPreferredOrder(uniquePhysicalColumnValues(warehouseMaterialRows, 7), DEPARTMENT_ORDER));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueValues(rows, "productLine"));
  populateSeriesFilter(rows);
  fillSelect($("#ageFilter"), "全部库龄", AGE_BUCKETS);
  fillSelect($("#warehouseLocationFilter"), "全部仓库位置", uniqueValues(rows, "warehouseLocation"));
}

function populateSeriesFilter(rows) {
  const productLines = getSelectValues($("#productLineFilter"));
  const scopedRows = rows.filter((row) => matchSelect(row.productLine, productLines));
  fillSelect($("#seriesFilter"), "全部销售系列", uniqueValues(scopedRows, "series"));
}

function renderSummary() {
  const query = normalizeKey($("#searchInput").value);
  const ageBuckets = getSelectValues($("#ageFilter"));
  const selectedAgeLabels = getSelectedAgeBucketLabels(ageBuckets);
  filteredRows = summaryRows.filter((row) => {
    const hit = !query || [row.materialCode, row.materialName, row.warehouse, row.organization, row.department, row.productLine, row.series, row.pmcType, row.pmcBasis, row.pmcReason]
      .some((value) => normalizeKey(value).includes(query));
    return hit
      && matchAgeBucket(row, ageBuckets)
      && matchSelect(row.warehouseType, getSelectValues($("#warehouseTypeFilter")))
      && matchSelect(row.department, getSelectValues($("#departmentFilter")))
      && matchSelect(row.productLine, getSelectValues($("#productLineFilter")))
      && matchSelect(row.series, getSelectValues($("#seriesFilter")))
      && matchSelect(row.warehouseLocation, getSelectValues($("#warehouseLocationFilter")));
  });
  const visibleAmount = sumVisibleAmount(filteredRows, selectedAgeLabels);
  $("#qtyTotal").textContent = formatNumberWithYi(sumVisibleQuantity(filteredRows, selectedAgeLabels), 3);
  $("#amountTotal").textContent = formatMoneyWithYi(visibleAmount);
  $("#valueGapTotal").textContent = formatMoneyWithYi(visibleAmount - closedInventoryValue);
  renderAgeShareCards(filteredRows, selectedAgeLabels);
  renderSummaryTables(filteredRows, selectedAgeLabels);
  renderAmountCharts(filteredRows, selectedAgeLabels);
  renderQuantityCharts(filteredRows, selectedAgeLabels);
  renderUnclassifiedRows(filteredRows, selectedAgeLabels);
  const shown = filteredRows.slice(0, 1000);
  $("#summaryRows").innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td class="num">${formatOptionalNumber(row.inventoryDays, 0)}</td>
      <td class="num">${formatNumber(row.endingQty, 3)}</td>
      <td class="num">${formatNumber(row.settlementPrice, 6)}</td>
      <td class="num">${formatMoney(row.settlementAmount)}</td>
      <td>${escapeHtml(row.pmcBasis)}</td>
      <td>${escapeHtml(row.pmcReason)}</td>
    </tr>
  `).join("") : `<tr><td colspan="9" class="empty">暂无数据</td></tr>`;
}

function renderUnclassifiedRows(rows, selectedAgeLabels = []) {
  const body = $("#unclassifiedRows");
  if (!body) return;
  const dataRows = getUnclassifiedRows(rows).slice(0, 1000);
  body.innerHTML = dataRows.length ? dataRows.map((row) => `
    <tr>
      <td>${escapeHtml(getUnclassifiedReason(row))}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.productLine || "未分类")}</td>
      <td>${escapeHtml(row.warehouseLocation || "未分类")}</td>
      <td class="num">${formatNumber(visibleQuantity(row, selectedAgeLabels), 3)}</td>
      <td class="num">${formatMoney(visibleAmount(row, selectedAgeLabels))}</td>
      <td>${escapeHtml(row.pmcBasis)}</td>
      <td>${escapeHtml(row.pmcReason)}</td>
    </tr>
  `).join("") : `<tr><td colspan="10" class="empty">暂无未分类明细</td></tr>`;
}

function renderAmountCharts(rows, selectedAgeLabel = "") {
  renderBars("departmentAmountChart", groupComputedSum(rows, "department", (row) => visibleAmount(row, selectedAgeLabel), 12), "departmentAmountTotal");
  renderBars("ageAmountChart", groupAgeAmountSum(rows, selectedAgeLabel), "ageAmountTotal");
  renderBars("productLineAmountChart", groupComputedSum(rows, "productLine", (row) => visibleAmount(row, selectedAgeLabel), 12), "productLineAmountTotal");
  renderBars("warehouseLocationAmountChart", groupComputedSum(rows, "warehouseLocation", (row) => visibleAmount(row, selectedAgeLabel), 12), "warehouseLocationAmountTotal");
}

function renderQuantityCharts(rows, selectedAgeLabel = "") {
  renderQuantityBars("departmentQtyChart", groupComputedSum(rows, "department", (row) => visibleQuantity(row, selectedAgeLabel), 12), "departmentQtyTotal");
  renderQuantityBars("ageQtyChart", groupAgeQuantitySum(rows, selectedAgeLabel), "ageQtyTotal");
  renderQuantityBars("productLineQtyChart", groupComputedSum(rows, "productLine", (row) => visibleQuantity(row, selectedAgeLabel), 12), "productLineQtyTotal");
  renderQuantityBars("warehouseLocationQtyChart", groupComputedSum(rows, "warehouseLocation", (row) => visibleQuantity(row, selectedAgeLabel), 12), "warehouseLocationQtyTotal");
}

function renderAgeShareCards(rows, selectedAgeLabels = []) {
  const totalAmount = sumVisibleAmount(rows, selectedAgeLabels);
  WAREHOUSE_TYPE_CARDS.forEach((warehouseType, index) => {
    const el = $(`#warehouseTypeShare${index}`);
    if (!el) return;
    const amount = rows.reduce((total, row) => {
      if (normalizeKey(row.warehouseType) !== normalizeKey(warehouseType)) return total;
      return total + visibleAmount(row, selectedAgeLabels);
    }, 0);
    el.textContent = formatYiWithPercent(amount, totalAmount);
  });
}

function renderSummaryTables(rows, selectedAgeLabels = []) {
  renderTurnoverSummaryTable(rows, selectedAgeLabels);
  renderProductLineSummaryTable(rows, selectedAgeLabels);
  renderSeriesSummaryTable(rows, selectedAgeLabels);
}

function renderTurnoverSummaryTable(rows, selectedAgeLabels = []) {
  const buckets = selectedAgeLabels.length ? selectedAgeLabels : AGE_BUCKETS;
  const totalQty = sumVisibleQuantity(rows, selectedAgeLabels);
  const totalAmount = sumVisibleAmount(rows, selectedAgeLabels);
  const body = $("#turnoverSummaryRows");
  if (!body) return;
  const summaryRows = AGE_BUCKETS.map((bucket) => {
    const active = buckets.includes(bucket);
    const qty = active ? rows.reduce((total, row) => total + (Number(row.ageQuantities?.[bucket]) || 0), 0) : 0;
    const amount = active ? rows.reduce((total, row) => total + (Number(row.ageSettlementAmounts?.[bucket]) || 0), 0) : 0;
    return { name: bucket, qty, amount };
  });
  body.innerHTML = renderCompactSummaryRows(summaryRows, totalQty, totalAmount);
}

function renderProductLineSummaryTable(rows, selectedAgeLabels = []) {
  const body = $("#productLineSummaryRows");
  if (!body) return;
  const totalQty = sumVisibleQuantity(rows, selectedAgeLabels);
  const totalAmount = sumVisibleAmount(rows, selectedAgeLabels);
  const summaryRows = groupSummaryByKey(rows, "productLine", selectedAgeLabels);
  body.innerHTML = renderCompactSummaryRows(summaryRows, totalQty, totalAmount);
}

function renderSeriesSummaryTable(rows, selectedAgeLabels = []) {
  const body = $("#seriesSummaryRows");
  if (!body) return;
  const totalQty = sumVisibleQuantity(rows, selectedAgeLabels);
  const totalAmount = sumVisibleAmount(rows, selectedAgeLabels);
  const summaryRows = groupSummaryByKey(rows, "series", selectedAgeLabels);
  body.innerHTML = renderCompactSummaryRows(summaryRows, totalQty, totalAmount);
}

function groupSummaryByKey(rows, key, selectedAgeLabels = []) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || "未归类";
    const item = map.get(name) || { name, qty: 0, amount: 0 };
    item.qty += visibleQuantity(row, selectedAgeLabels);
    item.amount += visibleAmount(row, selectedAgeLabels);
    map.set(name, item);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function renderCompactSummaryRows(rows, totalQty, totalAmount) {
  const dataRows = rows.filter((row) => (Number(row.qty) || 0) !== 0 || (Number(row.amount) || 0) !== 0);
  if (!dataRows.length) return `<tr><td colspan="5" class="empty">暂无数据</td></tr>`;
  const totalRow = {
    name: "合计",
    qty: totalQty,
    amount: totalAmount,
    isTotal: true
  };
  return [...dataRows, totalRow].map((row) => `
    <tr class="${row.isTotal ? "summary-total-row" : ""}">
      <td>${escapeHtml(row.name)}</td>
      <td class="num">${formatNumber(row.qty, 3)}</td>
      <td class="num">${formatPercent(row.qty, totalQty)}</td>
      <td class="num">${formatAdaptiveDecimal(row.amount / 10000)}</td>
      <td class="num">${formatPercent(row.amount, totalAmount)}</td>
    </tr>
  `).join("");
}

function groupSum(rows, key, valueKey, limit = 12) {
  return groupComputedSum(rows, key, (row) => Number(row[valueKey]) || 0, limit);
}

function groupComputedSum(rows, key, valueGetter, limit = 12) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || "未归类";
    map.set(name, (map.get(name) || 0) + (Number(valueGetter(row)) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function groupAgeAmountSum(rows, selectedAgeLabels = []) {
  const buckets = selectedAgeLabels.length ? selectedAgeLabels : AGE_BUCKETS;
  const map = new Map(buckets.map((bucket) => [bucket, 0]));
  for (const row of rows) {
    for (const bucket of buckets) {
      map.set(bucket, (map.get(bucket) || 0) + (Number(row.ageSettlementAmounts?.[bucket]) || 0));
    }
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

function groupAgeQuantitySum(rows, selectedAgeLabels = []) {
  const buckets = selectedAgeLabels.length ? selectedAgeLabels : AGE_BUCKETS;
  const map = new Map(buckets.map((bucket) => [bucket, 0]));
  for (const row of rows) {
    for (const bucket of buckets) {
      map.set(bucket, (map.get(bucket) || 0) + (Number(row.ageQuantities?.[bucket]) || 0));
    }
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

function getAgeBucketLabel(value) {
  if (value === null || value === undefined || normalizeText(value) === "") return "未归类";
  const days = Number(value);
  if (!Number.isFinite(days)) return "未归类";
  if (days <= 30) return "0-30天";
  if (days <= 60) return "31-60天";
  if (days <= 90) return "61-90天";
  if (days <= 120) return "91-120天";
  return "120天以上";
}

function renderBars(id, rows, totalId = "") {
  const container = $(`#${id}`);
  if (!container) return;
  const total = sumChartRows(rows);
  updateChartTotal(totalId, total, formatWan);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(2, value / max * 100);
    const formattedValue = formatWan(value);
    const valueText = `${formattedValue}（${formatPercent(value, total)}）`;
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(valueText)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }).join("");
}

function renderQuantityBars(id, rows, totalId = "") {
  const container = $(`#${id}`);
  if (!container) return;
  const total = sumChartRows(rows);
  updateChartTotal(totalId, total, formatTenThousand);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(2, value / max * 100);
    const formattedValue = formatTenThousand(value);
    const valueText = `${formattedValue}（${formatPercent(value, total)}）`;
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(valueText)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }).join("");
}

function sumChartRows(rows) {
  return rows.reduce((total, row) => total + (Number(row.value) || 0), 0);
}

function updateChartTotal(id, total, formatter) {
  if (!id) return;
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = `合计 ${formatter(total)}`;
}

function downloadCurrentRows() {
  const headers = ["物料编码", "物料名称", "仓库", "库存天数", "0430结余库存数量", "结算价(含税)", "结算价金额", "判断依据（PMC口径）", "问题原因（PMC口径）"];
  const lines = [headers.join(",")];
  filteredRows.forEach((row) => {
    lines.push([
      row.materialCode,
      row.materialName,
      row.warehouse,
      row.inventoryDays,
      row.endingQty,
      row.settlementPrice,
      row.settlementAmount,
      row.pmcBasis,
      row.pmcReason
    ].map(csvCell).join(","));
  });
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `供应链库存分析_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadTurnoverSummary() {
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  const buckets = selectedAgeLabels.length ? selectedAgeLabels : AGE_BUCKETS;
  const rows = AGE_BUCKETS.map((bucket) => {
    const active = buckets.includes(bucket);
    return {
      name: bucket,
      qty: active ? filteredRows.reduce((total, row) => total + (Number(row.ageQuantities?.[bucket]) || 0), 0) : 0,
      amount: active ? filteredRows.reduce((total, row) => total + (Number(row.ageSettlementAmounts?.[bucket]) || 0), 0) : 0
    };
  });
  downloadSummaryRows("周转天数", rows);
}

function downloadProductLineSummary() {
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  downloadSummaryRows("产品线库存", groupSummaryByKey(filteredRows, "productLine", selectedAgeLabels));
}

function downloadSeriesSummary() {
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  downloadSummaryRows("产品系列", groupSummaryByKey(filteredRows, "series", selectedAgeLabels));
}

function downloadUnclassifiedRows() {
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  const headers = ["缺失项", "物料编码", "物料名称", "仓库", "销售产品线", "仓库位置", "0430结余库存数量", "结算价金额", "判断依据（PMC口径）", "问题原因（PMC口径）"];
  const lines = [headers.join(",")];
  getUnclassifiedRows(filteredRows).forEach((row) => {
    lines.push([
      getUnclassifiedReason(row),
      row.materialCode,
      row.materialName,
      row.warehouse,
      row.productLine || "未分类",
      row.warehouseLocation || "未分类",
      visibleQuantity(row, selectedAgeLabels),
      visibleAmount(row, selectedAgeLabels),
      row.pmcBasis,
      row.pmcReason
    ].map(csvCell).join(","));
  });
  downloadCsv(`未分类明细表_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
}

function getUnclassifiedRows(rows) {
  return rows.filter((row) => !normalizeText(row.productLine) || !normalizeText(row.warehouseLocation));
}

function getUnclassifiedReason(row) {
  const reasons = [];
  if (!normalizeText(row.productLine)) reasons.push("产品线未分类");
  if (!normalizeText(row.warehouseLocation)) reasons.push("仓库位置未分类");
  return reasons.join("、");
}

function downloadSummaryRows(title, rows) {
  const dataRows = rows.filter((row) => (Number(row.qty) || 0) !== 0 || (Number(row.amount) || 0) !== 0);
  const totalQty = dataRows.reduce((total, row) => total + (Number(row.qty) || 0), 0);
  const totalAmount = dataRows.reduce((total, row) => total + (Number(row.amount) || 0), 0);
  const headers = [title, "库存数量", "数量占比", "货值（万元）", "货值占比"];
  const lines = [headers.join(",")];
  [...dataRows, { name: "合计", qty: totalQty, amount: totalAmount }].forEach((row) => {
    lines.push([
      row.name,
      formatNumber(row.qty, 3),
      formatPercent(row.qty, totalQty),
      formatAdaptiveDecimal((Number(row.amount) || 0) / 10000),
      formatPercent(row.amount, totalAmount)
    ].map(csvCell).join(","));
  });
  downloadCsv(`${title}_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
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

function mapProductsByMaterialCode(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ["物料编码"]), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      productLine: firstText([firstValue(row, ["销售产品线", "产品线"]), nthValue(row, 7)]),
      series: firstText([firstValue(row, ["销售系列", "系列"]), nthValue(row, 8)])
    });
  }
  return map;
}

function mapWarehousesByName(rows) {
  const map = new Map();
  for (const row of rows) {
    const warehouse = normalizeText(nthValue(row, 2));
    if (!warehouse || map.has(warehouse)) continue;
    map.set(warehouse, {
      warehouseType: normalizeText(firstValue(row, ["一级仓库分类"])),
      warehouseLocation: firstText([firstValue(row, ["二级仓库分类", "仓库位置", "位置"]), nthValue(row, 8)])
    });
  }
  return map;
}

function mapWarehouseMaterialDimensions(rows) {
  const departmentByFactKey = new Map();
  for (const row of rows) {
    const factStyleKey = normalizeDepartmentKey(nthValue(row, 6));
    const department = getWarehouseMaterialDepartment(row);
    if (factStyleKey && department && !departmentByFactKey.has(factStyleKey)) departmentByFactKey.set(factStyleKey, department);
  }
  return { departmentByFactKey };
}

function lookupDepartment(maps, row) {
  for (const key of makeReceiptDepartmentLookupKeys(row)) {
    const department = maps.departmentByFactKey.get(key);
    if (department) return department;
  }
  return "";
}

function getDetailMaterialCode(row) {
  return normalizeMaterialCode(nthValue(row, 1) || firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]));
}

function getDetailWarehouse(row) {
  return normalizeText(firstText([
    nthValue(row, 3),
    firstValue(row, ["仓库", "仓库名称", "金蝶仓库", "库存仓库"]),
    firstValueByHeaderIncludes(row, ["仓库"])
  ]));
}

function getDetailOrganization(row) {
  return normalizeText(firstText([
    nthValue(row, 4),
    firstValue(row, ["使用组织", "库存组织", "组织"]),
    firstValueByHeaderIncludes(row, ["组织"])
  ]));
}

function getDetailMaterialName(row) {
  return normalizeText(firstValue(row, ["物料名称", "货品名称", "商品名称", "金蝶名称"]));
}

function getDetailEndingQty(row) {
  return firstNumber([
    firstValue(row, ["0430结余库存数量", "4月30日结余库存数量", "结余库存数量"]),
    firstValueByHeaderIncludes(row, ["0430", "结余", "库存", "数量"]),
    firstValueByHeaderIncludes(row, ["结余", "库存", "数量"])
  ]);
}

function getDetailInventoryDays(row) {
  return firstOptionalNumber([
    firstValue(row, ["库存天数", "库龄", "库龄天数", "在库天数", "库存周转天数"]),
    firstValueByHeaderIncludes(row, ["库存", "天数"]),
    firstValueByHeaderIncludes(row, ["库龄"]),
    firstValueByHeaderIncludes(row, ["在库", "天数"])
  ]);
}

function getAgeQuantities(row) {
  return Object.fromEntries(AGE_BUCKET_DEFINITIONS.map((definition) => [
    definition.label,
    getAgeQuantity(row, definition)
  ]));
}

function getAgeQuantity(row, definition) {
  return firstOptionalNumber([
    ...definition.candidates.map((name) => firstValue(row, [name])),
    firstValueByHeaderIncludes(row, [definition.label, "数量"])
  ]) || 0;
}

function getDetailSettlementPrice(row) {
  return firstNumber([
    nthValue(row, 16),
    firstValue(row, ["结算价(含税)", "结算价（含税）", "P列结算价(含税)", "P列结算价（含税）"])
  ]);
}

function getClosedInventoryQty(row) {
  return firstNumber([nthValue(row, 7)]);
}

function getClosedInventoryTrueCost(row) {
  return firstNumber([nthValue(row, 8)]);
}

function getClosedInventoryValue(row) {
  return getClosedInventoryQty(row) * getClosedInventoryTrueCost(row);
}

function getDetailProductLine(row) {
  return normalizeText(firstText([
    nthValue(row, 11),
    firstValue(row, ["销售产品线", "产品线"])
  ]));
}

function getDetailSeries(row) {
  return normalizeText(firstText([
    nthValue(row, 12),
    firstValue(row, ["销售系列", "系列"])
  ]));
}

function getDetailDepartment(row) {
  return normalizeText(firstText([
    nthValue(row, 21),
    firstValue(row, ["事业部"])
  ]));
}

function getPmcInventoryType(row) {
  return normalizeText(firstText([
    nthValue(row, 30),
    firstValue(row, ["库存类型判断（PMC口径）", "库存类型判断(PMC口径)", "库存类型判断", "AD列"])
  ]));
}

function getPmcBasis(row) {
  return normalizeText(firstText([
    nthValue(row, 31),
    firstValue(row, ["判断依据（PMC口径）", "判断依据(PMC口径)", "判断依据"])
  ]));
}

function getPmcReason(row) {
  return normalizeText(firstText([
    nthValue(row, 32),
    firstValue(row, ["问题原因（PMC口径）", "问题原因(PMC口径)", "问题原因"])
  ]));
}

function getWarehouseMaterialDepartment(row) {
  return normalizeText(nthValue(row, 7) || firstValue(row, ["事业部"]));
}

function makeReceiptDepartmentLookupKeys(row) {
  return [...new Set([
    // Excel口径：D列 & C列 & A列
    [nthValue(row, 4), nthValue(row, 3), nthValue(row, 1)].join(""),
    // 表头口径：库存组织 & 仓库名称 & 物料编码
    [
      firstValue(row, ["库存组织", "使用组织", "组织"]),
      firstValue(row, ["仓库名称", "仓库", "金蝶仓库", "库存仓库"]),
      firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"])
    ].join(""),
    // 兜底：如果解析后C/D列顺序被浏览器对象顺序影响，尝试 C列 & D列 & A列
    [nthValue(row, 3), nthValue(row, 4), nthValue(row, 1)].join("")
  ].map(normalizeDepartmentKey).filter(Boolean))];
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
}

function recordDepartmentMatch(department, row) {
  if (department) {
    departmentMatchDiagnostics.matched += 1;
    return;
  }
  departmentMatchDiagnostics.unmatched += 1;
  if (!departmentMatchDiagnostics.sample) {
    departmentMatchDiagnostics.sample = `D&C&A=${escapeStatusText([nthValue(row, 4), nthValue(row, 3), nthValue(row, 1)].join("&"))}`;
  }
}

function escapeStatusText(value) {
  const text = normalizeText(value);
  return text.length > 24 ? `${text.slice(0, 24)}...` : text || "-";
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

function firstOptionalNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text) continue;
    const value = toNumber(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function fillSelect(select, allLabel, values) {
  const current = getSelectValues(select);
  select.dataset.allLabel = allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
    </button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${current.length ? "" : "checked"}>
        <span>全部</span>
      </label>
      ${values.map((value) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(value)}" ${current.includes(value) ? "checked" : ""}>
          <span>${escapeHtml(value)}</span>
        </label>
      `).join("")}
    </div>
  `;
  select.querySelector(".multi-filter-button").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMultiFilter(select);
  });
  select.querySelector(".multi-filter-menu").addEventListener("click", (event) => event.stopPropagation());
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
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checkbox.dataset.all === "true";
  });
  updateMultiFilterLabel(select);
}

function getSelectValues(select) {
  return [...select.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function syncMultiFilterSelection(select, changedCheckbox) {
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

function updateMultiFilterLabel(select) {
  const buttonText = select.querySelector(".multi-filter-button span");
  if (!buttonText) return;
  const values = getSelectValues(select);
  const allLabel = select.dataset.allLabel || "全部";
  if (!values.length) {
    buttonText.textContent = allLabel;
  } else if (values.length === 1) {
    buttonText.textContent = values[0];
  } else if (values.length === 2) {
    buttonText.textContent = values.join("、");
  } else {
    buttonText.textContent = `已选${values.length}项`;
  }
}

function toggleMultiFilter(select) {
  const willOpen = !select.classList.contains("open");
  closeMultiFilters();
  select.classList.toggle("open", willOpen);
  const button = select.querySelector(".multi-filter-button");
  if (button) button.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function closeMultiFilters(event) {
  if (event?.target?.closest?.(".multi-filter")) return;
  document.querySelectorAll(".multi-filter.open").forEach((select) => {
    select.classList.remove("open");
    const button = select.querySelector(".multi-filter-button");
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function uniqueColumnValues(rows, columnNames) {
  return [...new Set(rows.map((row) => normalizeText(firstValue(row, columnNames))).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function uniquePhysicalColumnValues(rows, oneBasedIndex) {
  return [...new Set(rows.map((row) => normalizeText(nthValue(row, oneBasedIndex))).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sortByPreferredOrder(values, preferredOrder) {
  const rank = new Map(preferredOrder.map((value, index) => [value, index]));
  return [...values].sort((a, b) => {
    const aRank = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b, "zh-CN");
  });
}

function matchSelect(value, selected) {
  const values = Array.isArray(selected) ? selected : [selected].filter(Boolean);
  return !values.length || values.includes(value);
}

function matchAgeBucket(row, buckets) {
  const labels = getSelectedAgeBucketLabels(buckets);
  if (!labels.length) return true;
  return labels.some((label) => (Number(row.ageQuantities?.[label]) || 0) !== 0);
}

function getSelectedAgeBucketLabel(bucket) {
  if (AGE_BUCKETS.includes(bucket)) return bucket;
  if (bucket === "0-30") return "0-30天";
  if (bucket === "31-60") return "31-60天";
  if (bucket === "61-90") return "61-90天";
  if (bucket === "91-120") return "91-120天";
  if (bucket === "120+") return "120天以上";
  return "";
}

function getSelectedAgeBucketLabels(buckets) {
  const values = Array.isArray(buckets) ? buckets : [buckets].filter(Boolean);
  return [...new Set(values.map(getSelectedAgeBucketLabel).filter(Boolean))];
}

function visibleQuantity(row, selectedAgeLabels = []) {
  const labels = Array.isArray(selectedAgeLabels) ? selectedAgeLabels : getSelectedAgeBucketLabels(selectedAgeLabels);
  return labels.length
    ? labels.reduce((total, label) => total + (Number(row.ageQuantities?.[label]) || 0), 0)
    : Number(row.endingQty) || 0;
}

function visibleAmount(row, selectedAgeLabels = []) {
  const labels = Array.isArray(selectedAgeLabels) ? selectedAgeLabels : getSelectedAgeBucketLabels(selectedAgeLabels);
  return labels.length
    ? labels.reduce((total, label) => total + (Number(row.ageSettlementAmounts?.[label]) || 0), 0)
    : Number(row.settlementAmount) || 0;
}

function sumVisibleQuantity(rows, selectedAgeLabel = "") {
  return rows.reduce((total, row) => total + visibleQuantity(row, selectedAgeLabel), 0);
}

function sumVisibleAmount(rows, selectedAgeLabel = "") {
  return rows.reduce((total, row) => total + visibleAmount(row, selectedAgeLabel), 0);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function sumObjectValues(object) {
  return Object.values(object || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

function formatOptionalNumber(value, decimals = 0) {
  if (value === null || value === undefined || normalizeText(value) === "") return "";
  return formatNumber(value, decimals);
}

function formatNumberWithYi(value, decimals = 3) {
  const numeric = Number(value || 0);
  const yiValue = numeric / 100000000;
  const unitText = Math.abs(yiValue) >= 0.01
    ? `${formatNumber(yiValue, 2)}亿`
    : `${formatAdaptiveDecimal(numeric / 10000)}万`;
  return `${formatNumber(numeric, decimals)}（${unitText}）`;
}

function formatMoneyWithYi(value) {
  const numeric = Number(value || 0);
  return `${formatMoney(numeric)}（${formatNumber(numeric / 100000000, 2)}亿）`;
}

function formatYiWithPercent(value, total) {
  const numeric = Number(value) || 0;
  const amountText = Math.abs(numeric) < 1000000
    ? `${formatAdaptiveDecimal(numeric / 10000)}万元`
    : `${formatAdaptiveDecimal(numeric / 100000000)}亿`;
  return `${amountText}（${formatPercent(numeric, total)}）`;
}

function formatWan(value) {
  return `${formatAdaptiveDecimal(Number(value || 0) / 10000)}万元`;
}

function formatTenThousand(value) {
  return `${formatAdaptiveDecimal(Number(value || 0) / 10000)}万`;
}

function formatAdaptiveDecimal(value) {
  const numeric = Number(value || 0);
  const abs = Math.abs(numeric);
  if (abs === 0) return formatNumber(0, 1);
  if (abs >= 1) return formatNumber(numeric, 1);
  if (abs >= 0.1) return formatNumber(numeric, 2);
  if (abs >= 0.01) return formatNumber(numeric, 3);
  if (abs >= 0.001) return formatNumber(numeric, 4);
  return formatNumber(numeric, 6);
}

function formatPercent(value, total) {
  const numeric = Number(value) || 0;
  const denominator = Number(total) || 0;
  if (!denominator) return "0%";
  return `${formatAdaptiveDecimal(numeric / denominator * 100)}%`;
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
