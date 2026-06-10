const $ = (selector) => document.querySelector(selector);

let currentErrorTables = {
  closed: emptyErrorResult(),
  detail: emptyErrorResult()
};

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runErrorChecks);
  $("#downloadAllBtn").addEventListener("click", downloadAllErrorTables);
  await loadSharedLibrary({ statusEl: $("#checkStatus") });
  await runErrorChecks();
});

async function runErrorChecks() {
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const maps = buildDimensionMaps(records);
  const closed = buildClosedInventoryChecks(records, maps);
  const detail = buildInventoryMonthChecks(records, maps);

  currentErrorTables = { closed, detail };
  renderCheckGroup("closed", closed);
  renderCheckGroup("detail", detail);

  const messages = [
    closed.message || `关账后库存事实表：有库存物料 ${formatNumber(closed.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(closed))} 项`,
    detail.message || `库存分析月份表：有库存物料 ${formatNumber(detail.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(detail))} 项`
  ];
  $("#checkStatus").textContent = `检查完成：${new Date().toLocaleString("zh-CN")}；${messages.join("；")}`;
}

function emptyErrorResult(message = "") {
  return {
    message,
    stockMaterials: [],
    productMissing: [],
    divisionMissing: [],
    warehouseMissing: [],
    settlementMissing: []
  };
}

function buildDimensionMaps(records) {
  const productMap = mapProduct(records["dim-product"]?.rows || []);
  const divisionRows = records["dim-warehouse-material"]?.rows || [];
  const warehouseRows = records["dim-warehouse"]?.rows || [];
  return {
    productMap,
    divisionMaterialCodes: mapDivisionMaterialCodes(divisionRows),
    divisionDepartmentKeys: mapDivisionDepartmentKeys(divisionRows),
    divisionWarehouses: mapDivisionWarehouses(divisionRows),
    warehouseNames: mapWarehouseNames(warehouseRows)
  };
}

function buildClosedInventoryChecks(records, maps) {
  const fact = records["fact-inventory"];
  if (!fact) return emptyErrorResult("关账后库存事实表：未引用");
  if (!records["dim-product"]) return emptyErrorResult("关账后库存事实表：缺少商品分类维表");
  if (!records["dim-warehouse-material"]) return emptyErrorResult("关账后库存事实表：缺少仓库物料事业部对照表");

  const stockMaterials = summarizeClosedStockMaterials(fact.rows || []);
  const stockWarehouses = summarizeClosedStockWarehouses(fact.rows || []);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const divisionMissing = stockMaterials.filter((item) => !maps.divisionMaterialCodes.has(item.materialCode));
  const warehouseSet = maps.warehouseNames.size ? maps.warehouseNames : maps.divisionWarehouses;
  const warehouseMissing = stockWarehouses.filter((item) => !warehouseSet.has(item.warehouse));
  const settlementMissing = stockMaterials.filter((item) => {
    const product = maps.productMap.get(item.materialCode);
    return product && isSalesFinishedProduct(product) && product.settlementPrice <= 0;
  });

  return {
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    divisionMissing: divisionMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    warehouseMissing,
    settlementMissing: settlementMissing.map((item) => enrichMissingRow(item, maps.productMap))
  };
}

function buildInventoryMonthChecks(records, maps) {
  const detail = records["fact-2"];
  if (!detail) return emptyErrorResult("库存分析月份表：未引用");
  if (!records["dim-product"]) return emptyErrorResult("库存分析月份表：缺少商品分类维表");
  if (!records["dim-warehouse-material"]) return emptyErrorResult("库存分析月份表：缺少仓库物料事业部对照表");

  const rows = detail.rows || [];
  const stockMaterials = summarizeDetailStockMaterials(rows);
  const stockWarehouses = summarizeDetailStockWarehouses(rows);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const divisionMissing = summarizeDetailDivisionMissing(rows, maps.divisionDepartmentKeys, maps.productMap);
  const warehouseMissing = maps.warehouseNames.size
    ? stockWarehouses.filter((item) => !maps.warehouseNames.has(item.warehouse))
    : [];
  const settlementMissing = stockMaterials.filter((item) => {
    const product = maps.productMap.get(item.materialCode);
    return product && isSalesFinishedProduct(product) && product.settlementPrice <= 0;
  });

  return {
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    divisionMissing,
    warehouseMissing,
    settlementMissing: settlementMissing.map((item) => enrichMissingRow(item, maps.productMap))
  };
}

function summarizeClosedStockMaterials(rows) {
  return summarizeByMaterial(rows, getClosedMaterialCode, getClosedMaterialName, getClosedStockQty);
}

function summarizeDetailStockMaterials(rows) {
  return summarizeByMaterial(rows, getDetailMaterialCode, getDetailMaterialName, getDetailStockQty);
}

function summarizeByMaterial(rows, materialGetter, nameGetter, qtyGetter) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = materialGetter(row);
    if (!materialCode) continue;
    const qty = qtyGetter(row);
    if (qty <= 0) continue;
    if (!map.has(materialCode)) {
      map.set(materialCode, {
        materialCode,
        sku: normalizeText(firstValue(row, ["SKU"])),
        materialName: nameGetter(row),
        qty: 0
      });
    }
    const item = map.get(materialCode);
    item.qty += qty;
    if (!item.sku) item.sku = normalizeText(firstValue(row, ["SKU"]));
    if (!item.materialName) item.materialName = nameGetter(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.materialCode.localeCompare(b.materialCode, "zh-CN"));
}

function summarizeClosedStockWarehouses(rows) {
  return summarizeByWarehouse(rows, getClosedWarehouse, getClosedStockQty);
}

function summarizeDetailStockWarehouses(rows) {
  return summarizeByWarehouse(rows, getDetailWarehouse, getDetailStockQty);
}

function summarizeByWarehouse(rows, warehouseGetter, qtyGetter) {
  const map = new Map();
  for (const row of rows) {
    const warehouse = warehouseGetter(row);
    if (!warehouse) continue;
    const qty = qtyGetter(row);
    if (qty <= 0) continue;
    map.set(warehouse, (map.get(warehouse) || 0) + qty);
  }
  return [...map.entries()]
    .map(([warehouse, qty]) => ({ warehouse, qty }))
    .sort((a, b) => b.qty - a.qty || a.warehouse.localeCompare(b.warehouse, "zh-CN"));
}

function summarizeDetailDivisionMissing(rows, departmentKeys, productMap) {
  const map = new Map();
  for (const row of rows) {
    const qty = getDetailStockQty(row);
    if (qty <= 0) continue;
    const materialCode = getDetailMaterialCode(row);
    if (!materialCode) continue;
    const departmentKey = makeDetailDepartmentKey(row);
    if (departmentKeys.has(departmentKey)) continue;
    if (!map.has(materialCode)) {
      map.set(materialCode, {
        materialCode,
        sku: normalizeText(firstValue(row, ["SKU"])),
        materialName: getDetailMaterialName(row),
        qty: 0
      });
    }
    const item = map.get(materialCode);
    item.qty += qty;
    if (!item.materialName) item.materialName = getDetailMaterialName(row);
  }
  return [...map.values()]
    .map((item) => enrichMissingRow(item, productMap))
    .sort((a, b) => b.qty - a.qty || a.materialCode.localeCompare(b.materialCode, "zh-CN"));
}

function mapProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ["物料编码"]),
      nthValue(row, 1)
    ]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      sku: normalizeText(firstText([firstValue(row, ["SKU"]), nthValue(row, 3)])),
      materialName: normalizeText(firstText([firstValue(row, ["金蝶名称", "物料名称", "货品名称"]), nthValue(row, 4)])),
      productLine: normalizeText(firstText([firstValue(row, ["销售产品线", "产品线"]), nthValue(row, 7)])),
      materialGroup: normalizeText(firstValue(row, ["物料分组"])),
      category1: normalizeText(firstValue(row, ["一级品类"])),
      productStatus: normalizeText(firstValue(row, ["产品状态（Dim）", "产品状态"])),
      settlementPrice: firstNumber([
        firstValue(row, ["结算价（含税）", "结算价(含税)", "结算价含税", "结算价", "内部结算价", "26年内部结算价", "2026年内部结算价"]),
        firstValueByHeaderIncludes(row, ["结算价"]),
        nthValue(row, 9)
      ])
    });
  }
  return map;
}

function isSalesFinishedProduct(product) {
  const productLine = normalizeText(product.productLine);
  if (!productLine) return false;
  if (["其他/配件", "配件", "售后配件", "健康办公"].includes(productLine)) return false;
  if (productLine.includes("配件") && !productLine.includes("成品")) return false;
  return true;
}

function mapDivisionMaterialCodes(rows) {
  const set = new Set();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ["物料编码"]),
      nthValue(row, 3)
    ]));
    if (materialCode) set.add(materialCode);
  }
  return set;
}

function mapDivisionDepartmentKeys(rows) {
  const set = new Set();
  for (const row of rows) {
    const key = normalizeDepartmentKey(firstText([
      firstValue(row, ["F列", "匹配键", "三元组合", "三元联合键"]),
      nthValue(row, 6),
      [
        firstValue(row, ["使用组织", "库存组织", "组织"]),
        firstValue(row, ["仓库名称", "仓库", "金蝶仓库", "库存仓库"]),
        firstValue(row, ["物料编码"])
      ].join("")
    ]));
    if (key) set.add(key);
  }
  return set;
}

function mapDivisionWarehouses(rows) {
  const set = new Set();
  for (const row of rows) {
    const warehouse = normalizeText(firstText([
      firstValue(row, ["仓库", "仓库名称", "金蝶名称"]),
      nthValue(row, 2)
    ]));
    if (warehouse) set.add(warehouse);
  }
  return set;
}

function mapWarehouseNames(rows) {
  const set = new Set();
  for (const row of rows) {
    const warehouse = normalizeText(firstText([
      firstValue(row, ["仓库金蝶名称", "仓库名称", "金蝶名称", "仓库"]),
      nthValue(row, 2)
    ]));
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
    productLine: product.productLine || "",
    qty: item.qty
  };
}

function renderCheckGroup(prefix, result) {
  renderMetrics(prefix, result);
  renderRows(`#${prefix}ProductMissingRows`, result.productMissing);
  renderRows(`#${prefix}DivisionMissingRows`, result.divisionMissing);
  renderWarehouseRows(`#${prefix}WarehouseMissingRows`, result.warehouseMissing);
  renderSettlementRows(`#${prefix}SettlementMissingRows`, result.settlementMissing);
}

function renderMetrics(prefix, result) {
  $(`#${prefix}StockMaterialCount`).textContent = formatNumber(result.stockMaterials.length);
  $(`#${prefix}ProductMissingCount`).textContent = formatNumber(result.productMissing.length);
  $(`#${prefix}DivisionMissingCount`).textContent = formatNumber(result.divisionMissing.length);
  $(`#${prefix}WarehouseMissingCount`).textContent = formatNumber(result.warehouseMissing.length);
  $(`#${prefix}SettlementMissingCount`).textContent = formatNumber(result.settlementMissing.length);
}

function renderRows(selector, rows) {
  const tbody = $(selector);
  if (!tbody) return;
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
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.warehouse)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="2" class="empty">暂无缺失数据</td></tr>`;
}

function renderSettlementRows(selector, rows) {
  const tbody = $(selector);
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty">暂无缺失数据</td></tr>`;
}

function downloadAllErrorTables() {
  if (typeof XLSX === "undefined") {
    window.alert("下载组件未加载，请刷新页面后重试。");
    return;
  }
  const stamp = downloadTimestamp();
  downloadCheckGroup("关账后库存事实表", stamp, currentErrorTables.closed);
  downloadCheckGroup("库存分析月份表", stamp, currentErrorTables.detail);
}

function downloadCheckGroup(label, stamp, result) {
  downloadRowsAsWorkbook(`${label}-商品维度缺失表`, stamp, result.productMissing, [
    ["materialCode", "物料编码"],
    ["sku", "SKU"],
    ["materialName", "物料名称"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook(`${label}-仓库与物料维度表缺失`, stamp, result.divisionMissing, [
    ["materialCode", "物料编码"],
    ["sku", "SKU"],
    ["materialName", "物料名称"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook(`${label}-仓库名称`, stamp, result.warehouseMissing, [
    ["warehouse", "仓库"],
    ["qty", "数量"]
  ]);
  downloadRowsAsWorkbook(`${label}-结算价缺失表`, stamp, result.settlementMissing, [
    ["materialCode", "物料编码"],
    ["materialName", "物料名称"],
    ["productLine", "销售产品线"],
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

function getClosedMaterialCode(row) {
  return normalizeMaterialCode(firstValue(row, ["物料编码"]));
}

function getClosedMaterialName(row) {
  return normalizeText(firstValue(row, ["物料名称", "金蝶名称", "货品名称"]));
}

function getClosedWarehouse(row) {
  return normalizeText(firstValue(row, ["仓库", "仓库名称", "金蝶名称"]));
}

function getClosedStockQty(row) {
  return firstNumber([
    firstValue(row, ["数量", "库存数量", "结存数量", "(结存)数量（库存）", "K-现货+在途库存"]),
    nthValue(row, 7)
  ]);
}

function getDetailMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]),
    nthValue(row, 1)
  ]));
}

function getDetailWarehouse(row) {
  return normalizeText(firstText([
    firstValue(row, ["仓库", "仓库名称", "金蝶仓库", "库存仓库"]),
    nthValue(row, 3)
  ]));
}

function getDetailOrganization(row) {
  return normalizeText(firstText([
    firstValue(row, ["使用组织", "库存组织", "组织"]),
    nthValue(row, 4)
  ]));
}

function getDetailMaterialName(row) {
  return normalizeText(firstValue(row, ["物料名称", "货品名称", "商品名称", "金蝶名称"]));
}

function getDetailStockQty(row) {
  return firstNumber([
    firstValue(row, ["合计库存数量", "合计数量", "合计"]),
    firstValueByHeaderIncludes(row, ["合计", "库存", "数量"]),
    firstValueByHeaderIncludes(row, ["合计", "数量"]),
    firstValue(row, ["0430结余库存数量", "4月30日结余库存数量", "结余库存数量"])
  ]);
}

function makeDetailDepartmentKey(row) {
  return normalizeDepartmentKey([
    getDetailOrganization(row),
    getDetailWarehouse(row),
    getDetailMaterialCode(row)
  ].join(""));
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
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

function totalMissingCount(result) {
  return result.productMissing.length + result.divisionMissing.length + result.warehouseMissing.length + result.settlementMissing.length;
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
