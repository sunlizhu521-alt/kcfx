const $ = (selector) => document.querySelector(selector);
let currentProductMissing = [];
let currentDivisionMissing = [];
let currentWarehouseMissing = [];
let currentSettlementMissing = [];

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runErrorChecks);
  $("#downloadAllBtn").addEventListener("click", downloadAllErrorTables);
  await loadSharedLibrary({ statusEl: $("#checkStatus") });
  await runErrorChecks();
});

async function runErrorChecks() {
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  const fact = records["fact-inventory"];
  const product = records["dim-product"];
  const division = records["dim-warehouse-material"];

  if (!fact || !product || !division) {
    $("#checkStatus").textContent = "缺少关账后库存事实表、商品分类维表或仓库物料事业部对照表，请先上传并应用刷新。";
    renderMetrics([], [], [], [], []);
    renderRows("#productMissingRows", []);
    renderRows("#divisionMissingRows", []);
    renderWarehouseRows("#warehouseMissingRows", []);
    currentProductMissing = [];
    currentDivisionMissing = [];
    currentWarehouseMissing = [];
    currentSettlementMissing = [];
    renderSettlementRows("#settlementMissingRows", []);
    return;
  }

  const stockMaterials = summarizeStockMaterials(fact.rows || []);
  const stockWarehouses = summarizeStockWarehouses(fact.rows || []);
  const productMap = mapProduct(product.rows || []);
  const divisionCodes = mapDivisionMaterialCodes(division.rows || []);
  const divisionWarehouses = mapDivisionWarehouses(division.rows || []);

  const productMissing = stockMaterials.filter((item) => !productMap.has(item.materialCode));
  const divisionMissing = stockMaterials.filter((item) => !divisionCodes.has(item.materialCode));
  const warehouseMissing = stockWarehouses.filter((item) => !divisionWarehouses.has(item.warehouse));
  const settlementMissing = stockMaterials.filter((item) => {
    const productItem = productMap.get(item.materialCode);
    return !productItem || productItem.settlementPrice <= 0;
  });

  const enrichedProductMissing = productMissing.map((item) => enrichMissingRow(item, productMap));
  const enrichedDivisionMissing = divisionMissing.map((item) => enrichMissingRow(item, productMap));
  const enrichedSettlementMissing = settlementMissing.map((item) => enrichMissingRow(item, productMap));
  currentProductMissing = enrichedProductMissing;
  currentDivisionMissing = enrichedDivisionMissing;
  currentWarehouseMissing = warehouseMissing;
  currentSettlementMissing = enrichedSettlementMissing;

  renderMetrics(stockMaterials, enrichedProductMissing, enrichedDivisionMissing, warehouseMissing, enrichedSettlementMissing);
  renderRows("#productMissingRows", enrichedProductMissing);
  renderRows("#divisionMissingRows", enrichedDivisionMissing);
  renderWarehouseRows("#warehouseMissingRows", warehouseMissing);
  renderSettlementRows("#settlementMissingRows", enrichedSettlementMissing);
  $("#checkStatus").textContent = `检查完成：${new Date().toLocaleString("zh-CN")}`;
}

function summarizeStockMaterials(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeText(firstValue(row, ["物料编码"]));
    if (!materialCode) continue;
    const qty = toNumber(firstValue(row, [
      "数量",
      "库存数量",
      "结存数量",
      "(结存)数量（库存）",
      "K-现货+在途库存"
    ]));
    if (qty <= 0) continue;

    if (!map.has(materialCode)) {
      map.set(materialCode, {
        materialCode,
        sku: normalizeText(firstValue(row, ["SKU"])),
        materialName: normalizeText(firstValue(row, ["物料名称", "金蝶名称", "货品名称"])),
        qty: 0
      });
    }
    const item = map.get(materialCode);
    item.qty += qty;
    if (!item.sku) item.sku = normalizeText(firstValue(row, ["SKU"]));
    if (!item.materialName) item.materialName = normalizeText(firstValue(row, ["物料名称", "金蝶名称", "货品名称"]));
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.materialCode.localeCompare(b.materialCode, "zh-CN"));
}

function summarizeStockWarehouses(rows) {
  const map = new Map();
  for (const row of rows) {
    const warehouse = normalizeText(firstValue(row, ["仓库", "仓库名称", "金蝶名称"]));
    if (!warehouse) continue;
    const qty = toNumber(firstValue(row, [
      "数量",
      "库存数量",
      "结存数量",
      "(结存)数量（库存）",
      "K-现货+在途库存"
    ]));
    if (qty <= 0) continue;
    map.set(warehouse, (map.get(warehouse) || 0) + qty);
  }
  return [...map.entries()]
    .map(([warehouse, qty]) => ({ warehouse, qty }))
    .sort((a, b) => b.qty - a.qty || a.warehouse.localeCompare(b.warehouse, "zh-CN"));
}

function mapProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeText(firstValue(row, ["物料编码"]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      sku: normalizeText(firstValue(row, ["SKU"])),
      materialName: normalizeText(firstValue(row, ["金蝶名称", "物料名称", "货品名称"])),
      settlementPrice: toNumber(firstValue(row, ["结算价（含税）", "结算价", "内部结算价", "26年内部结算价", "2026年内部结算价"]))
    });
  }
  return map;
}

function mapDivisionMaterialCodes(rows) {
  const set = new Set();
  for (const row of rows) {
    const materialCode = normalizeText(firstValue(row, ["物料编码"]));
    if (materialCode) set.add(materialCode);
  }
  return set;
}

function mapDivisionWarehouses(rows) {
  const set = new Set();
  for (const row of rows) {
    const warehouse = normalizeText(firstValue(row, ["仓库", "仓库名称", "金蝶名称"]));
    if (warehouse) set.add(warehouse);
  }
  return set;
}

function enrichMissingRow(item, productMap) {
  const product = productMap.get(item.materialCode) || {};
  return {
    materialCode: item.materialCode,
    sku: item.sku || product.sku || "",
    materialName: item.materialName || product.materialName || "",
    qty: item.qty
  };
}

function renderMetrics(stockMaterials, productMissing, divisionMissing, warehouseMissing, settlementMissing) {
  $("#stockMaterialCount").textContent = formatNumber(stockMaterials.length);
  $("#productMissingCount").textContent = formatNumber(productMissing.length);
  $("#divisionMissingCount").textContent = formatNumber(divisionMissing.length);
  $("#warehouseMissingCount").textContent = formatNumber(warehouseMissing.length);
  $("#settlementMissingCount").textContent = formatNumber(settlementMissing.length);
}

function renderRows(selector, rows) {
  const tbody = $(selector);
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.sku)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty">暂无缺失数据</td></tr>`;
}

function renderWarehouseRows(selector, rows) {
  const tbody = $(selector);
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.warehouse)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="2" class="empty">暂无缺失数据</td></tr>`;
}

function renderSettlementRows(selector, rows) {
  const tbody = $(selector);
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="3" class="empty">暂无缺失数据</td></tr>`;
}

function downloadAllErrorTables() {
  if (typeof XLSX === "undefined") {
    window.alert("下载组件未加载，请刷新页面后重试。");
    return;
  }
  const stamp = downloadTimestamp();
  downloadRowsAsWorkbook("商品维度缺失表", stamp, currentProductMissing, [
    ["materialCode", "物料编码"],
    ["sku", "SKU"],
    ["materialName", "物料名称"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook("仓库与物料维度表缺失", stamp, currentDivisionMissing, [
    ["materialCode", "物料编码"],
    ["sku", "SKU"],
    ["materialName", "物料名称"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook("仓库名称", stamp, currentWarehouseMissing, [
    ["warehouse", "仓库"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook("结算价缺失表", stamp, currentSettlementMissing, [
    ["materialCode", "物料编码"],
    ["materialName", "物料名称"],
    ["qty", "数量"]
  ]);
}

function downloadRowsAsWorkbook(prefix, stamp, rows, columns) {
  const data = rows.map((row) => {
    const item = {};
    for (const [key, label] of columns) {
      item[label] = row[key] ?? "";
    }
    return item;
  });
  const worksheet = XLSX.utils.json_to_sheet(data.length ? data : [Object.fromEntries(columns.map(([, label]) => [label, ""]))]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "报错明细");
  XLSX.writeFile(workbook, `${prefix}${stamp}.xlsx`);
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
