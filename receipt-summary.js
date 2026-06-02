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
const COLORS = ["#0f7b79", "#405c9a", "#2f8f5b", "#b87618", "#6c5ce7", "#d35400", "#2980b9", "#7f8c8d"];
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

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", clearFilters);
  $("#downloadBtn").addEventListener("click", downloadCurrentRows);
  document.addEventListener("click", closeMultiFilters);
  $("#searchInput").addEventListener("input", renderSummary);
  $("#productLineFilter").addEventListener("change", () => {
    populateSeriesFilter(summaryRows);
    renderSummary();
  });
  ["departmentFilter", "seriesFilter", "ageFilter", "warehouseLocationFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("change", renderSummary);
  });
  await refreshSummary();
});

async function refreshSummary() {
  await loadSharedLibrary({ statusEl: $("#summaryStatus") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
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
  const fileUpdatedAt = formatRecordTime(detailRecord.appliedAt || detailRecord.savedAt);
  $("#summaryStatus").textContent = `已读取 ${formatNumber(summaryRows.length, 0)} 行，事业部匹配 ${formatNumber(departmentMatchDiagnostics.matched, 0)} 行，读取文件更新时间：${fileUpdatedAt}${diagnostic}：${detailRecord.fileName || "-"}`;
  renderSummary();
}

function clearFilters() {
  clearSelect($("#departmentFilter"));
  clearSelect($("#productLineFilter"));
  populateSeriesFilter(summaryRows);
  clearSelect($("#seriesFilter"));
  clearSelect($("#ageFilter"));
  clearSelect($("#warehouseLocationFilter"));
  $("#searchInput").value = "";
  renderSummary();
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
      && matchSelect(row.department, getSelectValues($("#departmentFilter")))
      && matchSelect(row.productLine, getSelectValues($("#productLineFilter")))
      && matchSelect(row.series, getSelectValues($("#seriesFilter")))
      && matchSelect(row.warehouseLocation, getSelectValues($("#warehouseLocationFilter")));
  });
  $("#qtyTotal").textContent = formatNumberWithYi(sumVisibleQuantity(filteredRows, selectedAgeLabels), 3);
  $("#amountTotal").textContent = formatMoneyWithYi(sumVisibleAmount(filteredRows, selectedAgeLabels));
  renderAmountCharts(filteredRows, selectedAgeLabels);
  renderQuantityCharts(filteredRows, selectedAgeLabels);
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

function renderAmountCharts(rows, selectedAgeLabel = "") {
  renderBars("departmentAmountChart", groupComputedSum(rows, "department", (row) => visibleAmount(row, selectedAgeLabel), 12));
  renderBars("ageAmountChart", groupAgeAmountSum(rows, selectedAgeLabel));
  renderBars("productLineAmountChart", groupComputedSum(rows, "productLine", (row) => visibleAmount(row, selectedAgeLabel), 12));
  renderBars("warehouseLocationAmountChart", groupComputedSum(rows, "warehouseLocation", (row) => visibleAmount(row, selectedAgeLabel), 12));
}

function renderQuantityCharts(rows, selectedAgeLabel = "") {
  renderQuantityBars("departmentQtyChart", groupComputedSum(rows, "department", (row) => visibleQuantity(row, selectedAgeLabel), 12));
  renderQuantityBars("ageQtyChart", groupAgeQuantitySum(rows, selectedAgeLabel));
  renderQuantityBars("productLineQtyChart", groupComputedSum(rows, "productLine", (row) => visibleQuantity(row, selectedAgeLabel), 12));
  renderQuantityBars("warehouseLocationQtyChart", groupComputedSum(rows, "warehouseLocation", (row) => visibleQuantity(row, selectedAgeLabel), 12));
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

function renderBars(id, rows) {
  const container = $(`#${id}`);
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(2, value / max * 100);
    const formattedValue = formatWan(value);
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(formattedValue)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(formattedValue)}</div>
      </div>
    `;
  }).join("");
}

function renderQuantityBars(id, rows) {
  const container = $(`#${id}`);
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(2, value / max * 100);
    const formattedValue = formatTenThousand(value);
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(formattedValue)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(formattedValue)}</div>
      </div>
    `;
  }).join("");
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
  } else {
    buttonText.textContent = `已选 ${values.length} 项`;
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
  return `${formatNumber(numeric, decimals)}（${formatNumber(numeric / 100000000, 2)}亿）`;
}

function formatMoneyWithYi(value) {
  const numeric = Number(value || 0);
  return `${formatMoney(numeric)}（${formatNumber(numeric / 100000000, 2)}亿）`;
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
