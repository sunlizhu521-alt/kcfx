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
let summaryRows = [];
let filteredRows = [];

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", clearFilters);
  $("#downloadBtn").addEventListener("click", downloadCurrentRows);
  ["departmentFilter", "seriesFilter", "warehouseLocationFilter", "ageFilter", "searchInput"].forEach((id) => {
    $(`#${id}`).addEventListener(id === "searchInput" ? "input" : "change", renderSummary);
  });
  $("#productLineFilter").addEventListener("change", () => {
    populateSeriesFilter(summaryRows);
    renderSummary();
  });
  $("#warehouseTypeFilter").addEventListener("change", () => {
    populateWarehouseLocationFilter(summaryRows);
    renderSummary();
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
  renderSourcePanel(detailRecord);
  if (!detailRecord) {
    summaryRows = [];
    $("#summaryStatus").textContent = "缺少收发明细汇总表，请先到备货事实表库上传并应用。";
    populateFilters([]);
    renderSummary();
    return;
  }

  const productMap = mapProductsByMaterialCode(productRecord?.rows || []);
  const warehouseMap = mapWarehousesByName(warehouseRecord?.rows || []);
  const departmentMaps = mapDepartmentsByJoinKey(warehouseMaterialRecord?.rows || []);
  summaryRows = (detailRecord.rows || []).map((row) => {
    const materialCode = getDetailMaterialCode(row);
    const warehouse = getDetailWarehouse(row);
    const organization = getDetailOrganization(row);
    const materialName = getDetailMaterialName(row);
    const endingQty = getDetailEndingQty(row);
    const inventoryDays = getDetailInventoryDays(row);
    const settlementPrice = getDetailSettlementPrice(row);
    const product = productMap.get(materialCode) || {};
    const warehouseInfo = warehouseMap.get(warehouse) || {};
    return {
      materialCode,
      materialName,
      department: lookupDepartment(departmentMaps, organization, warehouse, materialCode),
      productLine: product.productLine || "",
      series: product.series || "",
      warehouseType: warehouseInfo.warehouseType || "",
      warehouseLocation: warehouseInfo.warehouseLocation || "",
      warehouse,
      organization,
      inventoryDays,
      endingQty,
      settlementPrice,
      settlementAmount: endingQty * settlementPrice
    };
  });
  populateFilters(summaryRows);
  $("#summaryStatus").textContent = `已读取 ${formatNumber(summaryRows.length, 0)} 行：${detailRecord.fileName || "-"}`;
  renderSummary();
}

function clearFilters() {
  $("#departmentFilter").value = "";
  $("#productLineFilter").value = "";
  $("#warehouseTypeFilter").value = "";
  populateSeriesFilter(summaryRows);
  populateWarehouseLocationFilter(summaryRows);
  $("#seriesFilter").value = "";
  $("#warehouseLocationFilter").value = "";
  $("#ageFilter").value = "";
  $("#searchInput").value = "";
  renderSummary();
}

function renderSourcePanel(record) {
  if (!record) {
    $("#sourcePanel").innerHTML = "";
    return;
  }
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  $("#sourcePanel").innerHTML = `<div><strong>收发明细汇总表</strong>：${escapeHtml(record.fileName || "-")}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>IndexedDB: ${KC_DB_NAME}/${KC_STORE}/fact-2</code></div>`;
}

function populateFilters(rows) {
  fillSelect($("#departmentFilter"), "全部事业部", sortByPreferredOrder(uniqueValues(rows, "department"), DEPARTMENT_ORDER));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueValues(rows, "productLine"));
  fillSelect($("#warehouseTypeFilter"), "全部仓库类型", uniqueValues(rows, "warehouseType"));
  populateSeriesFilter(rows);
  populateWarehouseLocationFilter(rows);
}

function populateSeriesFilter(rows) {
  const productLine = $("#productLineFilter").value;
  const scopedRows = rows.filter((row) => matchSelect(row.productLine, productLine));
  fillSelect($("#seriesFilter"), "全部销售系列", uniqueValues(scopedRows, "series"));
}

function populateWarehouseLocationFilter(rows) {
  const warehouseType = $("#warehouseTypeFilter").value;
  const scopedRows = rows.filter((row) => matchSelect(row.warehouseType, warehouseType));
  fillSelect($("#warehouseLocationFilter"), "全部仓库位置", uniqueValues(scopedRows, "warehouseLocation"));
}

function renderSummary() {
  const query = normalizeKey($("#searchInput").value);
  const ageBucket = $("#ageFilter").value;
  filteredRows = summaryRows.filter((row) => {
    const hit = !query || [row.materialCode, row.materialName, row.warehouse, row.organization, row.department, row.productLine, row.series, row.warehouseType, row.warehouseLocation]
      .some((value) => normalizeKey(value).includes(query));
    return hit
      && matchAgeBucket(row.inventoryDays, ageBucket)
      && matchSelect(row.department, $("#departmentFilter").value)
      && matchSelect(row.productLine, $("#productLineFilter").value)
      && matchSelect(row.series, $("#seriesFilter").value)
      && matchSelect(row.warehouseType, $("#warehouseTypeFilter").value)
      && matchSelect(row.warehouseLocation, $("#warehouseLocationFilter").value);
  });
  $("#rowCount").textContent = formatNumber(filteredRows.length, 0);
  $("#qtyTotal").textContent = formatNumberWithYi(sum(filteredRows, "endingQty"), 3);
  $("#amountTotal").textContent = formatMoneyWithYi(sum(filteredRows, "settlementAmount"));
  const shown = filteredRows.slice(0, 1000);
  $("#summaryRows").innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td>${escapeHtml(row.series)}</td>
      <td>${escapeHtml(row.warehouseType)}</td>
      <td>${escapeHtml(row.warehouseLocation)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td class="num">${formatOptionalNumber(row.inventoryDays, 0)}</td>
      <td class="num">${formatNumber(row.endingQty, 3)}</td>
      <td class="num">${formatNumber(row.settlementPrice, 6)}</td>
      <td class="num">${formatMoney(row.settlementAmount)}</td>
    </tr>
  `).join("") : `<tr><td colspan="11" class="empty">暂无数据</td></tr>`;
}

function downloadCurrentRows() {
  const headers = ["物料编码", "物料名称", "销售产品线", "销售系列", "仓库类型", "仓库位置", "仓库", "库存天数", "0430结余库存数量", "结算价(含税)", "结算价金额"];
  const lines = [headers.join(",")];
  filteredRows.forEach((row) => {
    lines.push([
      row.materialCode,
      row.materialName,
      row.productLine,
      row.series,
      row.warehouseType,
      row.warehouseLocation,
      row.warehouse,
      row.inventoryDays,
      row.endingQty,
      row.settlementPrice,
      row.settlementAmount
    ].map(csvCell).join(","));
  });
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `收发汇总分析_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`;
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

function mapDepartmentsByJoinKey(rows) {
  const full = new Map();
  const warehouseMaterial = new Map();
  const material = new Map();
  for (const row of rows) {
    const organization = normalizeText(firstText([firstValue(row, ["使用组织", "库存组织", "组织"]), nthValue(row, 1)]));
    const warehouse = normalizeText(firstText([firstValue(row, ["仓库名称", "仓库", "金蝶仓库"]), nthValue(row, 2)]));
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]), nthValue(row, 3)]));
    const department = normalizeText(firstText([firstValue(row, ["事业部"]), nthValue(row, 7)]));
    if (!department) continue;
    const fullKey = makeDepartmentLookupKey(organization, warehouse, materialCode);
    const warehouseMaterialKey = makeWarehouseMaterialLookupKey(warehouse, materialCode);
    if (fullKey && !full.has(fullKey)) full.set(fullKey, department);
    if (warehouseMaterialKey && !warehouseMaterial.has(warehouseMaterialKey)) warehouseMaterial.set(warehouseMaterialKey, department);
    if (materialCode && !material.has(materialCode)) material.set(materialCode, department);
  }
  return { full, warehouseMaterial, material };
}

function lookupDepartment(maps, organization, warehouse, materialCode) {
  const fullKey = makeDepartmentLookupKey(organization, warehouse, materialCode);
  const warehouseMaterialKey = makeWarehouseMaterialLookupKey(warehouse, materialCode);
  return maps.full.get(fullKey)
    || maps.warehouseMaterial.get(warehouseMaterialKey)
    || maps.material.get(normalizeMaterialCode(materialCode))
    || "";
}

function getDetailMaterialCode(row) {
  return normalizeMaterialCode(firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]) || nthValue(row, 1));
}

function getDetailWarehouse(row) {
  return normalizeText(firstText([
    firstValue(row, ["仓库", "仓库名称", "金蝶仓库", "库存仓库"]),
    firstValueByHeaderIncludes(row, ["仓库"])
  ]));
}

function getDetailOrganization(row) {
  return normalizeText(firstText([
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

function getDetailSettlementPrice(row) {
  return firstNumber([
    nthValue(row, 16),
    firstValue(row, ["结算价(含税)", "结算价（含税）", "P列结算价(含税)", "P列结算价（含税）"])
  ]);
}

function makeDepartmentLookupKey(organization, warehouse, materialCode) {
  return [
    normalizeText(organization),
    normalizeText(warehouse),
    normalizeMaterialCode(materialCode)
  ].join("");
}

function makeWarehouseMaterialLookupKey(warehouse, materialCode) {
  return [
    normalizeText(warehouse),
    normalizeMaterialCode(materialCode)
  ].join("");
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
  const current = select.value || "";
  select.innerHTML = [`<option value="">${allLabel}</option>`, ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  select.value = values.includes(current) ? current : "";
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))]
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
  return !selected || value === selected;
}

function matchAgeBucket(value, bucket) {
  if (!bucket) return true;
  if (value === null || value === undefined || normalizeText(value) === "") return false;
  const days = Number(value);
  if (!Number.isFinite(days)) return false;
  if (bucket === "0-30") return days >= 0 && days <= 30;
  if (bucket === "31-60") return days >= 31 && days <= 60;
  if (bucket === "61-90") return days >= 61 && days <= 90;
  if (bucket === "91-120") return days >= 91 && days <= 120;
  if (bucket === "120+") return days > 120;
  return true;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
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
