const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runErrorChecks);
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
    renderMetrics([], [], [], []);
    renderRows("#productMissingRows", []);
    renderRows("#divisionMissingRows", []);
    renderWarehouseRows("#warehouseMissingRows", []);
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

  const enrichedProductMissing = productMissing.map((item) => enrichMissingRow(item, productMap));
  const enrichedDivisionMissing = divisionMissing.map((item) => enrichMissingRow(item, productMap));

  renderMetrics(stockMaterials, enrichedProductMissing, enrichedDivisionMissing, warehouseMissing);
  renderRows("#productMissingRows", enrichedProductMissing);
  renderRows("#divisionMissingRows", enrichedDivisionMissing);
  renderWarehouseRows("#warehouseMissingRows", warehouseMissing);
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
      materialName: normalizeText(firstValue(row, ["金蝶名称", "物料名称", "货品名称"]))
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

function renderMetrics(stockMaterials, productMissing, divisionMissing, warehouseMissing) {
  $("#stockMaterialCount").textContent = formatNumber(stockMaterials.length);
  $("#productMissingCount").textContent = formatNumber(productMissing.length);
  $("#divisionMissingCount").textContent = formatNumber(divisionMissing.length);
  $("#warehouseMissingCount").textContent = formatNumber(warehouseMissing.length);
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
