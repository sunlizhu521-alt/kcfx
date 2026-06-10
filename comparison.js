const $ = (selector) => document.querySelector(selector);
const EPSILON = 0.000001;
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
let currentComparison = {
  inventoryQtyTotal: 0,
  detailQtyTotal: 0,
  qtyDiffTotal: 0,
  inventoryValueTotal: 0,
  detailValueTotal: 0,
  valueDiffTotal: 0,
  allRows: [],
  qtyDiffRows: [],
  priceDiffRows: []
};

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runComparison);
  $("#diffTypeFilter").addEventListener("change", () => {
    populateDimensionFilters(currentComparison, "type");
    renderCurrentDiffTable();
  });
  $("#departmentFilter").addEventListener("change", () => {
    populateDimensionFilters(currentComparison, "department");
    renderCurrentDiffTable();
  });
  $("#productLineFilter").addEventListener("change", () => {
    populateDimensionFilters(currentComparison, "productLine");
    renderCurrentDiffTable();
  });
  $("#seriesFilter").addEventListener("change", renderCurrentDiffTable);
  $("#downloadBtn").addEventListener("click", downloadCurrentDiffTable);
  await loadSharedLibrary({ statusEl: $("#compareStatus") });
  await runComparison();
});

async function runComparison() {
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const inventoryRecord = records["fact-inventory"];
  const detailRecord = records["fact-2"];
  const productRecord = records["dim-product"];
  const warehouseMaterialRecord = records["dim-warehouse-material"];

  renderSourcePanel(inventoryRecord, detailRecord);

  if (!inventoryRecord || !detailRecord) {
    $("#compareStatus").textContent = "缺少关账后库存事实表或库存分析月份表，请先到库存数据文件上传并应用刷新。";
    currentComparison = { inventoryQtyTotal: 0, detailQtyTotal: 0, qtyDiffTotal: 0, inventoryValueTotal: 0, detailValueTotal: 0, valueDiffTotal: 0, allRows: [], qtyDiffRows: [], priceDiffRows: [] };
    renderMetrics(currentComparison);
    $("#matchBasis").textContent = "等待两张事实表应用后生成对比。";
    renderCurrentDiffTable();
    return;
  }

  const detailRows = detailRecord.rows || [];
  const inventoryRows = inventoryRecord.rows || [];
  const keyOptions = detectKeyOptions(inventoryRows, detailRows);
  const inventoryMap = summarizeInventoryRows(inventoryRows, keyOptions);
  const detailMap = summarizeDetailRows(detailRows, keyOptions);
  const productMap = mapProductsByMaterialCode(productRecord?.rows || []);
  const departmentMap = mapDepartmentsByJoinKey(warehouseMaterialRecord?.rows || []);
  currentComparison = compareMaps(inventoryMap, detailMap, productMap, departmentMap);

  populateDimensionFilters(currentComparison);
  renderMatchBasis(keyOptions, inventoryRecord, detailRecord);
  renderCurrentDiffTable();
  $("#compareStatus").textContent = `对比完成：${new Date().toLocaleString("zh-CN", { hour12: false })}`;
}

function detectKeyOptions(inventoryRows, detailRows) {
  const sampleInventory = inventoryRows.slice(0, 200);
  const sampleDetail = detailRows.slice(0, 200);
  return {
    useOrganization: hasAnyValue(sampleInventory, getInventoryOrganization) && hasAnyValue(sampleDetail, getDetailOrganization),
    useWarehouse: hasAnyValue(sampleInventory, getInventoryWarehouse) && hasAnyValue(sampleDetail, getDetailWarehouse)
  };
}

function summarizeInventoryRows(rows, keyOptions) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = getInventoryMaterialCode(row);
    if (!materialCode) continue;
    const qty = toNumber(nthValue(row, 7));
    const price = getInventoryTrueCost(row);
    const item = ensureItem(map, makeComparisonKey(row, keyOptions, "inventory"), {
      organization: getInventoryOrganization(row),
      warehouse: getInventoryWarehouse(row),
      materialCode,
      materialName: getInventoryMaterialName(row)
    });
    item.inventoryQty += qty;
    item.inventoryValue += qty * price;
    if (price > 0 && qty !== 0) {
      item.inventoryPriceAmount += price * Math.abs(qty);
      item.inventoryPriceWeight += Math.abs(qty);
    } else if (price > 0 && item.inventoryPriceWeight === 0) {
      item.inventoryPriceAmount += price;
      item.inventoryPriceWeight += 1;
    }
  }
  return map;
}

function summarizeDetailRows(rows, keyOptions) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = getDetailMaterialCode(row);
    if (!materialCode) continue;
    const qty = getDetailEndingQty(row);
    const price = getDetailSettlementPrice(row);
    const item = ensureItem(map, makeComparisonKey(row, keyOptions, "detail"), {
      organization: getDetailOrganization(row),
      warehouse: getDetailWarehouse(row),
      materialCode,
      materialName: getDetailMaterialName(row)
    });
    item.detailQty += qty;
    item.detailValue += qty * price;
    if (price > 0 && qty !== 0) {
      item.detailPriceAmount += price * Math.abs(qty);
      item.detailPriceWeight += Math.abs(qty);
    } else if (price > 0 && item.detailPriceWeight === 0) {
      item.detailPriceAmount += price;
      item.detailPriceWeight += 1;
    }
  }
  return map;
}

function compareMaps(inventoryMap, detailMap, productMap, departmentMap) {
  const keys = new Set([...inventoryMap.keys(), ...detailMap.keys()]);
  const rows = [...keys].map((key) => {
    const inventory = inventoryMap.get(key) || {};
    const detail = detailMap.get(key) || {};
    const inventoryPrice = averagePrice(inventory.inventoryPriceAmount, inventory.inventoryPriceWeight);
    const detailPrice = averagePrice(detail.detailPriceAmount, detail.detailPriceWeight);
    const materialCode = inventory.materialCode || detail.materialCode || "";
    const organization = inventory.organization || detail.organization || "";
    const warehouse = inventory.warehouse || detail.warehouse || "";
    const product = productMap.get(materialCode) || {};
    return {
      key,
      organization,
      warehouse,
      materialCode,
      materialName: inventory.materialName || detail.materialName || "",
      department: departmentMap.get(makeDepartmentLookupKey(organization, warehouse, materialCode)) || "未分事业部",
      productLine: product.productLine || "",
      series: product.series || "",
      inventoryQty: inventory.inventoryQty || 0,
      detailQty: detail.detailQty || 0,
      qtyDiff: (inventory.inventoryQty || 0) - (detail.detailQty || 0),
      inventoryPrice,
      detailPrice,
      priceDiff: inventoryPrice - detailPrice,
      inventoryValue: inventory.inventoryValue || 0,
      detailValue: detail.detailValue || 0,
      valueDiff: (inventory.inventoryValue || 0) - (detail.detailValue || 0)
    };
  });

  const qtyDiffRows = rows
    .filter((row) => Math.abs(row.qtyDiff) > EPSILON)
    .sort((a, b) => Math.abs(b.qtyDiff) - Math.abs(a.qtyDiff))
    .slice(0, 1000);
  const priceDiffRows = rows
    .filter((row) => row.inventoryPrice > 0 && row.detailPrice > 0 && Math.abs(row.priceDiff) > 0.0001)
    .sort((a, b) => Math.abs(b.priceDiff) - Math.abs(a.priceDiff))
    .slice(0, 1000);

  return {
    inventoryQtyTotal: rows.reduce((sum, row) => sum + row.inventoryQty, 0),
    detailQtyTotal: rows.reduce((sum, row) => sum + row.detailQty, 0),
    qtyDiffTotal: rows.reduce((sum, row) => sum + row.qtyDiff, 0),
    inventoryValueTotal: rows.reduce((sum, row) => sum + row.inventoryValue, 0),
    detailValueTotal: rows.reduce((sum, row) => sum + row.detailValue, 0),
    valueDiffTotal: rows.reduce((sum, row) => sum + row.valueDiff, 0),
    allRows: rows,
    qtyDiffRows,
    priceDiffRows
  };
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

function mapDepartmentsByJoinKey(rows) {
  const map = new Map();
  for (const row of rows) {
    const organization = normalizeText(nthValue(row, 1));
    const warehouse = normalizeText(nthValue(row, 2));
    const materialCode = normalizeMaterialCode(nthValue(row, 3));
    const department = normalizeText(nthValue(row, 7));
    const key = makeDepartmentLookupKey(organization, warehouse, materialCode);
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

function makeDepartmentLookupKey(organization, warehouse, materialCode) {
  return [
    normalizeText(organization),
    normalizeText(warehouse),
    normalizeMaterialCode(materialCode)
  ].join("");
}

function ensureItem(map, key, defaults) {
  if (!map.has(key)) {
    map.set(key, {
      ...defaults,
      inventoryQty: 0,
      detailQty: 0,
      inventoryPriceAmount: 0,
      inventoryPriceWeight: 0,
      inventoryValue: 0,
      detailPriceAmount: 0,
      detailPriceWeight: 0,
      detailValue: 0
    });
  }
  const item = map.get(key);
  if (!item.organization) item.organization = defaults.organization || "";
  if (!item.warehouse) item.warehouse = defaults.warehouse || "";
  if (!item.materialName) item.materialName = defaults.materialName || "";
  return item;
}

function makeComparisonKey(row, options, source) {
  const organization = source === "inventory" ? getInventoryOrganization(row) : getDetailOrganization(row);
  const warehouse = source === "inventory" ? getInventoryWarehouse(row) : getDetailWarehouse(row);
  const materialCode = source === "inventory" ? getInventoryMaterialCode(row) : getDetailMaterialCode(row);
  return [
    options.useOrganization ? normalizeKeyPart(organization) : "",
    options.useWarehouse ? normalizeKeyPart(warehouse) : "",
    normalizeMaterialCode(materialCode)
  ].join("|");
}

function getInventoryMaterialCode(row) {
  return normalizeMaterialCode(nthValue(row, 1) || firstValue(row, ["物料编码"]));
}

function getInventoryWarehouse(row) {
  return normalizeText(nthValue(row, 6) || firstValue(row, ["仓库", "仓库名称"]));
}

function getInventoryOrganization(row) {
  return normalizeText(nthValue(row, 12) || firstValue(row, ["使用组织", "库存组织"]));
}

function getInventoryMaterialName(row) {
  return normalizeText(firstValue(row, ["物料名称", "货品名称", "金蝶名称"]) || nthValue(row, 5));
}

function getInventoryTrueCost(row) {
  return firstNumber([nthValue(row, 8)]);
}

function getDetailMaterialCode(row) {
  return normalizeMaterialCode(firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]) || nthValue(row, 1));
}

function getDetailWarehouse(row) {
  return normalizeText(firstValue(row, ["仓库", "仓库名称", "金蝶仓库", "库存仓库"]));
}

function getDetailOrganization(row) {
  return normalizeText(firstValue(row, ["使用组织", "库存组织", "组织"]));
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

function getDetailSettlementPrice(row) {
  return firstNumber([
    nthValue(row, 16),
    firstValue(row, ["结算价(含税)", "结算价（含税）", "P列结算价(含税)", "P列结算价（含税）"])
  ]);
}

function hasAnyValue(rows, getter) {
  return rows.some((row) => normalizeText(getter(row)) !== "");
}

function firstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    const value = toNumber(candidate);
    if (value !== 0 || text === "0") return value;
  }
  return 0;
}

function averagePrice(amount, weight) {
  return weight > 0 ? amount / weight : 0;
}

function normalizeKeyPart(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function firstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return "";
}

function populateDimensionFilters(result, changed = "all") {
  const rows = baseDiffRows(result);
  if (changed === "type" || changed === "all") {
    fillSelect($("#departmentFilter"), "全部事业部", sortByPreferredOrder(uniqueValues(rows, "department"), DEPARTMENT_ORDER));
  }
  const departmentRows = rows.filter((row) => matchSelect(row.department, $("#departmentFilter").value));
  if (changed === "type" || changed === "all" || changed === "department") {
    fillSelect($("#productLineFilter"), "全部销售产品线", uniqueValues(departmentRows, "productLine"));
  }
  const productLineRows = departmentRows.filter((row) => matchSelect(row.productLine, $("#productLineFilter").value));
  if (changed === "type" || changed === "all" || changed === "department" || changed === "productLine") {
    fillSelect($("#seriesFilter"), "全部销售系列", uniqueValues(productLineRows, "series"));
  }
}

function baseDiffRows(result) {
  return ($("#diffTypeFilter").value || "qty") === "price" ? result.priceDiffRows : result.qtyDiffRows;
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

function filterRows(rows) {
  return rows.filter((row) => matchSelect(row.department, $("#departmentFilter").value)
    && matchSelect(row.productLine, $("#productLineFilter").value)
    && matchSelect(row.series, $("#seriesFilter").value));
}

function matchSelect(value, selected) {
  return !selected || value === selected;
}

function renderMetrics(result, qtyRows = result.qtyDiffRows, priceRows = result.priceDiffRows) {
  const valueRows = filterRows(result.allRows || []);
  $("#inventoryQtyTotal").textContent = formatNumberWithYi(result.inventoryQtyTotal);
  $("#detailQtyTotal").textContent = formatNumberWithYi(result.detailQtyTotal);
  $("#qtyDiffTotal").textContent = formatNumber(qtyRows.reduce((sum, row) => sum + row.qtyDiff, 0), 3);
  const inventoryValue = valueRows.reduce((sum, row) => sum + row.inventoryValue, 0);
  const detailValue = valueRows.reduce((sum, row) => sum + row.detailValue, 0);
  $("#inventoryValueTotal").textContent = formatMoneyWithYi(inventoryValue);
  $("#detailValueTotal").textContent = formatMoneyWithYi(detailValue);
  $("#valueDiffTotal").textContent = formatMoneyWithYi(inventoryValue - detailValue);
}

function formatNumberWithYi(value) {
  const numeric = Number(value || 0);
  return `${formatNumber(numeric, 3)}（${(numeric / 100000000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿）`;
}

function formatMoneyWithYi(value) {
  const numeric = Number(value || 0);
  return `¥${numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}（${(numeric / 100000000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿）`;
}

function renderMatchBasis(options, inventoryRecord, detailRecord) {
  const parts = ["物料编码"];
  if (options.useOrganization) parts.unshift("使用组织");
  if (options.useWarehouse) parts.splice(options.useOrganization ? 1 : 0, 0, "仓库");
  $("#matchBasis").textContent = [
    `匹配键：${parts.join(" + ")}`,
    `关账后库存事实表：结存数量取 G 列，库存资产估值取 G 列 × H 列真实成本单价。`,
    `库存分析月份表：0430结余库存数量按列名识别，结算价(含税)固定取 P 列。`,
    `当前文件：${inventoryRecord.fileName || "-"} / ${detailRecord.fileName || "-"}`
  ].join(" ");
}

function renderSourcePanel(inventoryRecord, detailRecord) {
  const items = [
    sourceLine("关账后库存事实表", "fact-inventory", inventoryRecord),
    sourceLine("库存分析月份表", "fact-2", detailRecord)
  ];
  $("#sourcePanel").innerHTML = items.join("");
}

function sourceLine(title, id, record) {
  if (!record) return `<div><strong>${escapeHtml(title)}</strong>：未应用</div>`;
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const path = `IndexedDB: ${KC_DB_NAME}/${KC_STORE}/${id}`;
  return `<div><strong>${escapeHtml(title)}</strong>：${escapeHtml(record.fileName || "-")}；行数：${formatNumber((record.rows || []).length, 0)}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>${escapeHtml(path)}</code></div>`;
}

function renderCurrentDiffTable() {
  const type = $("#diffTypeFilter").value || "qty";
  if (type === "price") {
    const rows = filterRows(currentComparison.priceDiffRows);
    renderMetrics(currentComparison, filterRows(currentComparison.qtyDiffRows), rows);
    renderPriceTable(rows);
    return;
  }
  const rows = filterRows(currentComparison.qtyDiffRows);
  renderMetrics(currentComparison, rows, filterRows(currentComparison.priceDiffRows));
  renderQtyTable(rows);
}

function renderQtyTable(rows) {
  $("#diffTableTitle").textContent = "数量差异：结存数量 vs 0430结余库存数量";
  $("#diffTableHead").innerHTML = `
    <tr>
      <th>使用组织</th>
      <th>仓库</th>
      <th>物料编码</th>
      <th>物料名称</th>
      <th>事业部</th>
      <th>销售产品线</th>
      <th>销售系列</th>
      <th>关账后库存结存数量</th>
      <th>收发明细0430结余库存数量</th>
      <th>差异</th>
    </tr>`;
  $("#diffTableRows").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.department)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td>${escapeHtml(row.series)}</td>
      <td class="num">${formatNumber(row.inventoryQty, 3)}</td>
      <td class="num">${formatNumber(row.detailQty, 3)}</td>
      <td class="num">${formatNumber(row.qtyDiff, 3)}</td>
    </tr>
  `).join("") : `<tr><td colspan="10" class="empty">暂无数量差异</td></tr>`;
}

function renderPriceTable(rows) {
  $("#diffTableTitle").textContent = "价格差异：真实成本-货品 vs P列结算价(含税)";
  $("#diffTableHead").innerHTML = `
    <tr>
      <th>使用组织</th>
      <th>仓库</th>
      <th>物料编码</th>
      <th>物料名称</th>
      <th>事业部</th>
      <th>销售产品线</th>
      <th>销售系列</th>
      <th>关账后库存真实成本-货品</th>
      <th>收发明细P列结算价(含税)</th>
      <th>差异</th>
    </tr>`;
  $("#diffTableRows").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.department)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td>${escapeHtml(row.series)}</td>
      <td class="num">${formatNumber(row.inventoryPrice, 4)}</td>
      <td class="num">${formatNumber(row.detailPrice, 4)}</td>
      <td class="num">${formatNumber(row.priceDiff, 4)}</td>
    </tr>
  `).join("") : `<tr><td colspan="10" class="empty">暂无价格差异</td></tr>`;
}

function downloadCurrentDiffTable() {
  const type = $("#diffTypeFilter").value || "qty";
  const rows = filterRows(type === "price" ? currentComparison.priceDiffRows : currentComparison.qtyDiffRows);
  const headers = type === "price"
    ? ["使用组织", "仓库", "物料编码", "物料名称", "事业部", "销售产品线", "销售系列", "关账后库存真实成本-货品", "收发明细P列结算价(含税)", "差异"]
    : ["使用组织", "仓库", "物料编码", "物料名称", "事业部", "销售产品线", "销售系列", "关账后库存结存数量", "收发明细0430结余库存数量", "差异"];
  const csvRows = [headers, ...rows.map((row) => type === "price"
    ? [row.organization, row.warehouse, row.materialCode, row.materialName, row.department, row.productLine, row.series, row.inventoryPrice, row.detailPrice, row.priceDiff]
    : [row.organization, row.warehouse, row.materialCode, row.materialName, row.department, row.productLine, row.series, row.inventoryQty, row.detailQty, row.qtyDiff]
  )];
  const csv = "\ufeff" + csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${type === "price" ? "价格差异" : "数量差异"}_${downloadTimestamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
