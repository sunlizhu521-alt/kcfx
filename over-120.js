const $ = (selector) => document.querySelector(selector);
const AGE_BUCKETS = ["0-30天", "31-60天", "61-90天", "91-120天", "120天以上"];
const AGE_BUCKET_DEFINITIONS = [
  { label: "0-30天", candidates: ["0-30天数量", "0-30天库存数量", "0-30天结余库存数量", "0-30天库龄数量", "0-30天"] },
  { label: "31-60天", candidates: ["31-60天数量", "31-60天库存数量", "31-60天结余库存数量", "31-60天库龄数量", "31-60天"] },
  { label: "61-90天", candidates: ["61-90天数量", "61-90天库存数量", "61-90天结余库存数量", "61-90天库龄数量", "61-90天"] },
  { label: "91-120天", candidates: ["91-120天数量", "91-120天库存数量", "91-120天结余库存数量", "91-120天库龄数量", "91-120天"] },
  { label: "120天以上", candidates: ["120天以上数量", "120天以上库存数量", "120天以上结余库存数量", "120天以上库龄数量", "120天及以上数量", "120天及以上库存数量", "120以上数量", "120天以上", "120天及以上", "120以上"] }
];
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

let allRows = [];
let filteredRows = [];

document.addEventListener("DOMContentLoaded", async () => {
  document.addEventListener("click", closeMultiFilters);
  $("#refreshBtn")?.addEventListener("click", clearFilters);
  $("#downloadBtn")?.addEventListener("click", downloadDetailRows);
  $("#searchInput")?.addEventListener("input", renderPage);
  $("#productLineFilter")?.addEventListener("change", () => {
    populateSeriesFilter(allRows);
    renderPage();
  });
  $("#warehouseTypeFilter")?.addEventListener("change", () => {
    populateWarehouseLocationFilter(allRows);
    renderPage();
  });
  ["departmentFilter", "seriesFilter", "ageFilter", "warehouseLocationFilter", "logisticsStatusFilter", "inventoryTypeFilter"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", renderPage);
  });
  await refreshOver120();
});

async function refreshOver120() {
  await loadSharedLibrary({ statusEl: $("#over120Status") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const detailRecord = records["fact-2"];
  const productRecord = records["dim-product"];
  const warehouseRecord = records["dim-warehouse"];
  const warehouseMaterialRecord = records["dim-warehouse-material"];

  renderSourcePanel(detailRecord);
  if (!detailRecord) {
    allRows = [];
    $("#over120Status").textContent = "缺少库存分析月份表，请先到库存数据文件上传并应用。";
    populateFilters([], records);
    renderPage();
    return;
  }

  const productMap = mapProductsByMaterialCode(productRecord?.rows || []);
  const warehouseMap = mapWarehousesByName(warehouseRecord?.rows || []);
  const warehouseMaterialMaps = mapWarehouseMaterialDimensions(warehouseMaterialRecord?.rows || []);
  let departmentMatched = 0;
  allRows = (detailRecord.rows || []).map((row) => {
    const materialCode = getDetailMaterialCode(row);
    const warehouse = getDetailWarehouse(row);
    const product = productMap.get(materialCode) || {};
    const warehouseInfo = warehouseMap.get(warehouse) || {};
    const department = lookupDepartment(warehouseMaterialMaps, row) || getDetailDepartment(row);
    if (department) departmentMatched += 1;
    const settlementPrice = getDetailSettlementPrice(row);
    const ageQuantities = getAgeQuantities(row);
    const ageSettlementAmounts = Object.fromEntries(
      Object.entries(ageQuantities).map(([label, qty]) => [label, qty * settlementPrice])
    );
    const endingQty = getDetailEndingQty(row);
    return {
      warehouse,
      materialCode,
      materialName: getDetailMaterialName(row),
      inventoryDays: getDetailInventoryDays(row),
      endingQty,
      settlementPrice,
      settlementAmount: endingQty * settlementPrice,
      department,
      productLine: getDetailProductLine(row) || product.productLine || "",
      series: getDetailSeries(row) || product.series || "",
      warehouseType: warehouseInfo.warehouseType || "",
      warehouseLocation: warehouseInfo.warehouseLocation || "",
      logisticsStatus: getLogisticsStatus(row),
      inventoryType: getInventoryType(row),
      reason: getReason(row),
      ageQuantities,
      ageSettlementAmounts
    };
  });

  populateFilters(allRows, records);
  $("#over120Status").textContent = buildStatus(allRows.length, departmentMatched, detailRecord, records);
  renderPage();
}

function buildStatus(rowCount, departmentMatched, detailRecord, records) {
  const refs = [
    ["库存分析月份表", detailRecord],
    ["商品分类维表", records["dim-product"]],
    ["仓库维表", records["dim-warehouse"]],
    ["仓库物料事业部对照表", records["dim-warehouse-material"]]
  ].map(([label, record]) => formatStatusRecord(label, record));
  return `已读取 ${formatNumber(rowCount, 0)} 行，事业部匹配 ${formatNumber(departmentMatched, 0)} 行；引用文件：${refs.join("；")}`;
}

function formatStatusRecord(label, record) {
  if (!record) return `${label}：未引用`;
  const updatedAt = record.appliedAt || record.savedAt ? new Date(record.appliedAt || record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  return `${label}：${record.fileName || "-"}（${updatedAt}）`;
}

function renderSourcePanel(record) {
  const panel = $("#sourcePanel");
  if (!panel) return;
  if (!record) {
    panel.innerHTML = "";
    return;
  }
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  panel.innerHTML = `
    <div><strong>库存分析月份表</strong>：${escapeHtml(record.fileName || "-")}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>IndexedDB: ${KC_DB_NAME}/${KC_STORE}/fact-2</code></div>
    <div class="source-reminder">AG列：库存位置/物流状态；AH列：库存类型；AI列：原因。</div>
  `;
}

function populateFilters(rows, records = {}) {
  const warehouseMaterialRows = records["dim-warehouse-material"]?.rows || [];
  fillSelect($("#warehouseTypeFilter"), "库存全链路", uniqueValues(rows, "warehouseType"));
  fillSelect($("#departmentFilter"), "全部事业部", sortByPreferredOrder(uniquePhysicalColumnValues(warehouseMaterialRows, 7), DEPARTMENT_ORDER));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueValues(rows, "productLine"));
  populateSeriesFilter(rows);
  fillSelect($("#ageFilter"), "全部库龄", AGE_BUCKETS, ["120天以上"]);
  fillSelect($("#warehouseLocationFilter"), "全部仓库位置", uniqueValues(rows, "warehouseLocation"));
  fillSelect($("#logisticsStatusFilter"), "库存位置/物流状态", uniqueValues(rows, "logisticsStatus"));
  fillSelect($("#inventoryTypeFilter"), "库存类型", uniqueValues(rows, "inventoryType"));
}

function populateSeriesFilter(rows) {
  const productLines = getSelectValues($("#productLineFilter"));
  const scopedRows = rows.filter((row) => matchSelect(row.productLine, productLines));
  fillSelect($("#seriesFilter"), "全部销售系列", uniqueValues(scopedRows, "series"));
}

function populateWarehouseLocationFilter(rows) {
  const warehouseTypes = getSelectValues($("#warehouseTypeFilter"));
  const scopedRows = rows.filter((row) => matchSelect(row.warehouseType, warehouseTypes));
  fillSelect($("#warehouseLocationFilter"), "全部仓库位置", uniqueValues(scopedRows, "warehouseLocation"));
}

function clearFilters() {
  clearSelect($("#warehouseTypeFilter"));
  clearSelect($("#departmentFilter"));
  clearSelect($("#productLineFilter"));
  populateSeriesFilter(allRows);
  clearSelect($("#seriesFilter"));
  setSelectValues($("#ageFilter"), ["120天以上"]);
  populateWarehouseLocationFilter(allRows);
  clearSelect($("#warehouseLocationFilter"));
  clearSelect($("#logisticsStatusFilter"));
  clearSelect($("#inventoryTypeFilter"));
  $("#searchInput").value = "";
  renderPage();
}

function renderPage() {
  const query = normalizeKey($("#searchInput")?.value || "");
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  filteredRows = allRows.filter((row) => {
    const hit = !query || [row.warehouse, row.materialCode, row.materialName, row.reason, row.logisticsStatus, row.inventoryType]
      .some((value) => normalizeKey(value).includes(query));
    return hit
      && matchAgeBucket(row, getSelectValues($("#ageFilter")))
      && matchSelect(row.warehouseType, getSelectValues($("#warehouseTypeFilter")))
      && matchSelect(row.department, getSelectValues($("#departmentFilter")))
      && matchSelect(row.productLine, getSelectValues($("#productLineFilter")))
      && matchSelect(row.series, getSelectValues($("#seriesFilter")))
      && matchSelect(row.warehouseLocation, getSelectValues($("#warehouseLocationFilter")))
      && matchSelect(row.logisticsStatus, getSelectValues($("#logisticsStatusFilter")))
      && matchSelect(row.inventoryType, getSelectValues($("#inventoryTypeFilter")));
  });
  renderCharts(filteredRows, selectedAgeLabels);
  renderDetails(filteredRows, selectedAgeLabels);
}

function renderCharts(rows, selectedAgeLabels) {
  renderBars("warehouseTypeAmountChart", groupComputedSum(rows, "warehouseType", (row) => visibleAmount(row, selectedAgeLabels), 12), "warehouseTypeAmountTotal");
  renderBars("departmentAmountChart", groupComputedSum(rows, "department", (row) => visibleAmount(row, selectedAgeLabels), 12), "departmentAmountTotal");
  renderBars("productLineAmountChart", groupComputedSum(rows, "productLine", (row) => visibleAmount(row, selectedAgeLabels), 12), "productLineAmountTotal");
  renderBars("seriesAmountChart", groupComputedSum(rows, "series", (row) => visibleAmount(row, selectedAgeLabels), 12), "seriesAmountTotal");
  renderBars("warehouseLocationAmountChart", groupComputedSum(rows, "warehouseLocation", (row) => visibleAmount(row, selectedAgeLabels), 12), "warehouseLocationAmountTotal");
}

function renderDetails(rows, selectedAgeLabels) {
  const body = $("#detailRows");
  if (!body) return;
  const shown = rows.slice(0, 1000);
  body.innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(visibleQuantity(row, selectedAgeLabels), 3)}</td>
      <td class="num">${formatNumber(row.settlementPrice, 6)}</td>
      <td class="num">${formatMoney(visibleAmount(row, selectedAgeLabels))}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">暂无数据</td></tr>`;
}

function downloadDetailRows() {
  const selectedAgeLabels = getSelectedAgeBucketLabels(getSelectValues($("#ageFilter")));
  const headers = ["仓库名称", "物料编码", "物料名称", "0430结余库存数量", "结算价(含税)", "库存总额", "原因"];
  const lines = [headers.join(",")];
  filteredRows.forEach((row) => {
    lines.push([
      row.warehouse,
      row.materialCode,
      row.materialName,
      visibleQuantity(row, selectedAgeLabels),
      row.settlementPrice,
      visibleAmount(row, selectedAgeLabels),
      row.reason
    ].map(csvCell).join(","));
  });
  downloadCsv(`120天以上库存明细_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
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
    const department = normalizeText(nthValue(row, 7) || firstValue(row, ["事业部"]));
    if (factStyleKey && department && !departmentByFactKey.has(factStyleKey)) departmentByFactKey.set(factStyleKey, department);
  }
  return { departmentByFactKey };
}

function lookupDepartment(maps, row) {
  for (const key of makeDepartmentLookupKeys(row)) {
    const department = maps.departmentByFactKey.get(key);
    if (department) return department;
  }
  return "";
}

function makeDepartmentLookupKeys(row) {
  return [...new Set([
    [nthValue(row, 4), nthValue(row, 3), nthValue(row, 1)].join(""),
    [nthValue(row, 3), nthValue(row, 4), nthValue(row, 1)].join(""),
    [
      firstValue(row, ["库存组织", "使用组织", "组织"]),
      firstValue(row, ["仓库名称", "仓库", "金蝶仓库", "库存仓库"]),
      firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"])
    ].join("")
  ].map(normalizeDepartmentKey).filter(Boolean))];
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

function getDetailSettlementPrice(row) {
  return firstNumber([
    nthValue(row, 16),
    firstValue(row, ["结算价(含税)", "结算价（含税）", "P列结算价(含税)", "P列结算价（含税）"])
  ]);
}

function getDetailProductLine(row) {
  return normalizeText(firstText([nthValue(row, 11), firstValue(row, ["销售产品线", "产品线"])]));
}

function getDetailSeries(row) {
  return normalizeText(firstText([nthValue(row, 12), firstValue(row, ["销售系列", "系列"])]));
}

function getDetailDepartment(row) {
  return normalizeText(firstText([nthValue(row, 21), firstValue(row, ["事业部"])]));
}

function getLogisticsStatus(row) {
  return normalizeText(firstText([
    nthValue(row, 33),
    firstValue(row, ["库存位置/物流状态", "库存位置", "物流状态", "AG列"])
  ]));
}

function getInventoryType(row) {
  return normalizeText(firstText([
    nthValue(row, 34),
    firstValue(row, ["库存类型", "AH列"])
  ]));
}

function getReason(row) {
  return normalizeText(firstText([
    nthValue(row, 35),
    firstValue(row, ["原因", "AI列"])
  ]));
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

function fillSelect(select, allLabel, values, defaultValues = null) {
  if (!select) return;
  const allowed = new Set(values);
  const current = getSelectValues(select).filter((value) => allowed.has(value));
  const defaults = (defaultValues || []).filter((value) => allowed.has(value));
  const selected = current.length ? current : defaults;
  select.dataset.allLabel = allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
    </button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${selected.length ? "" : "checked"}>
        <span>全部</span>
      </label>
      ${values.map((value) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""}>
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
  if (!select) return;
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checkbox.dataset.all === "true";
  });
  updateMultiFilterLabel(select);
}

function setSelectValues(select, values) {
  if (!select) return;
  const selected = new Set(values);
  select.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checkbox.dataset.all === "true" ? selected.size === 0 : selected.has(checkbox.value);
  });
  updateMultiFilterLabel(select);
}

function getSelectValues(select) {
  if (!select) return [];
  return [...select.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
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
  if (!buttonText) return;
  const values = getSelectValues(select);
  const allLabel = select.dataset.allLabel || "全部";
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

function renderBars(id, rows, totalId = "") {
  const container = $(`#${id}`);
  if (!container) return;
  const total = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  updateChartTotal(totalId, total);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(2, value / max * 100);
    const valueText = `${formatWan(value)}（${formatPercent(value, total)}）`;
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(valueText)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }).join("");
}

function updateChartTotal(id, total) {
  const el = id ? $(`#${id}`) : null;
  if (el) el.textContent = `合计 ${formatWan(total)}`;
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

function matchAgeBucket(row, buckets) {
  const labels = getSelectedAgeBucketLabels(buckets);
  if (!labels.length) return true;
  return labels.some((label) => (Number(row.ageQuantities?.[label]) || 0) !== 0);
}

function getSelectedAgeBucketLabels(buckets) {
  const values = Array.isArray(buckets) ? buckets : [buckets].filter(Boolean);
  return [...new Set(values.filter((value) => AGE_BUCKETS.includes(value)))];
}

function matchSelect(value, selected) {
  const values = Array.isArray(selected) ? selected : [selected].filter(Boolean);
  return !values.length || values.includes(value);
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))]
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

function nthValue(row, oneBasedIndex) {
  if (!row) return "";
  if (Array.isArray(row)) return row[oneBasedIndex - 1];
  const values = Object.values(row);
  return values[oneBasedIndex - 1];
}

function firstValue(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  return "";
}

function firstValueByHeaderIncludes(row, keywords) {
  const entries = Object.entries(row || {});
  const found = entries.find(([key]) => keywords.every((keyword) => normalizeKey(key).includes(normalizeKey(keyword))));
  return found ? found[1] : "";
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
}

function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/\.0$/, "");
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value).replace(/,/g, "").replace(/¥/g, "");
  if (!text || /^#/.test(text)) return 0;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : 0;
}

function formatOptionalNumber(value, decimals = 0) {
  if (value === null || value === undefined || normalizeText(value) === "") return "";
  return formatNumber(value, decimals);
}

function formatMoney(value) {
  return `¥${formatNumber(value, 2)}`;
}

function formatWan(value) {
  return `${formatAdaptiveDecimal(Number(value || 0) / 10000)}万元`;
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

function formatNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
