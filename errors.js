const $ = (selector) => document.querySelector(selector);

let currentErrorTables = {
  closed: emptyErrorResult(),
  detail: emptyErrorResult(),
  sales: emptySalesErrorResult()
};

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runErrorChecks);
  $("#downloadAllBtn").addEventListener("click", downloadAllErrorTables);
  document.querySelectorAll("[data-download-error]").forEach((button) => {
    button.addEventListener("click", () => downloadSingleErrorTable(button.dataset.downloadError));
  });
  await loadSharedLibrary({ statusEl: $("#checkStatus") });
  await runErrorChecks();
});

async function runErrorChecks() {
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const maps = buildDimensionMaps(records);
  const closed = buildClosedInventoryChecks(records, maps);
  const detail = buildInventoryMonthChecks(records, maps);
  const sales = buildSalesDataChecks(records, maps);

  currentErrorTables = { closed, detail, sales };
  renderCheckGroup("closed", closed);
  renderCheckGroup("detail", detail);
  renderSalesCheckGroup(sales);

  const messages = [
    closed.message || `关账后库存事实表：有库存物料 ${formatNumber(closed.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(closed))} 项`,
    detail.message || `库存分析月份表：有库存物料 ${formatNumber(detail.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(detail))} 项`,
    sales.message || `销售数据文件：销售物料 ${formatNumber(sales.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(sales))} 项`
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

function emptySalesErrorResult(message = "") {
  return {
    ...emptyErrorResult(message),
    salesRows: [],
    customerMaterialMissing: [],
    storeMissing: []
  };
}

function buildDimensionMaps(records) {
  const productMap = mapProduct(records["dim-product"]?.rows || []);
  const divisionRows = records["dim-warehouse-material"]?.rows || [];
  const warehouseRows = records["dim-warehouse"]?.rows || [];
  const customerMaterialRows = records["dim-store-name"]?.rows || [];
  const storeRecord = records["dim-customer-material"];
  const storeRows = storeRecord?.rows || [];
  const storeNameMap = mapStoreNames(storeRows);
  return {
    productMap,
    divisionMaterialCodes: mapDivisionMaterialCodes(divisionRows),
    divisionDepartmentKeys: mapDivisionDepartmentKeys(divisionRows),
    divisionWarehouses: mapDivisionWarehouses(divisionRows),
    warehouseNames: mapWarehouseNames(warehouseRows),
    customerMaterialKeys: mapCustomerMaterialKeys(customerMaterialRows),
    storeNames: new Set(storeNameMap.keys()),
    storeNameSamples: [...storeNameMap.values()].slice(0, 8),
    storeSummaryValid: isStoreSummaryRecordValid(storeRecord),
    storeSummaryRecord: storeRecord
  };
}

function isStoreSummaryRecordValid(record) {
  if (!record) return false;
  const sheetName = normalizeHeaderName(record.sheetName || record.parseDiagnostics?.sheetName || "");
  const headerB = normalizeHeaderName(record.headers?.[1] || record.parseDiagnostics?.headerFirst12?.[1] || "");
  return sheetName.includes(normalizeHeaderName("店铺名称汇总"))
    && headerB === normalizeHeaderName("金蝶名称");
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

function buildSalesDataChecks(records, maps) {
  const sales = records["sales-data"];
  if (!sales) return emptySalesErrorResult("销售数据文件：未引用");

  const rows = (sales.rows || []).filter((row) => getSalesMaterialCode(row) || getSalesStoreName(row) || getSalesStoreNameForStoreSummary(row) || getSalesCustomerName(row));
  const salesStoreValues = collectSalesStoreValues(rows);
  const stockMaterials = summarizeSalesMaterials(rows);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const customerMaterialMissing = summarizeSalesCustomerMaterialMissing(rows, maps.customerMaterialKeys, maps.productMap);
  const storeMissing = maps.storeSummaryValid ? summarizeSalesStoreMissing(rows, maps.storeNames) : [];

  return {
    ...emptySalesErrorResult(),
    salesRows: rows,
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    customerMaterialMissing,
    storeMissing,
    storeDiagnostic: buildSalesStoreDiagnostic(salesStoreValues, maps.storeNames, maps.storeNameSamples, maps.storeSummaryValid, maps.storeSummaryRecord)
  };
}

function collectSalesStoreValues(rows) {
  const map = new Map();
  for (const row of rows) {
    const store = getSalesStoreNameForStoreSummary(row);
    const normalized = normalizeStoreName(store);
    if (!store || !normalized) continue;
    if (!map.has(normalized)) map.set(normalized, { raw: store, normalized, qty: 0 });
    map.get(normalized).qty += getSalesReceivableQty(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.raw.localeCompare(b.raw, "zh-CN"));
}

function buildSalesStoreDiagnostic(salesStoreValues, storeNames, storeNameSamples = [], storeSummaryValid = true, storeSummaryRecord = null) {
  const hitCount = salesStoreValues.filter((item) => storeNames.has(item.normalized)).length;
  const missingCount = salesStoreValues.length - hitCount;
  return {
    salesCount: salesStoreValues.length,
    dimCount: storeNames.size,
    hitCount,
    missingCount,
    salesSamples: salesStoreValues.slice(0, 8).map((item) => item.raw),
    dimSamples: storeNameSamples,
    storeSummaryValid,
    storeSheetName: storeSummaryRecord?.sheetName || storeSummaryRecord?.parseDiagnostics?.sheetName || "",
    storeHeaderB: storeSummaryRecord?.headers?.[1] || storeSummaryRecord?.parseDiagnostics?.headerFirst12?.[1] || ""
  };
}

function summarizeClosedStockMaterials(rows) {
  return summarizeByMaterial(rows, getClosedMaterialCode, getClosedMaterialName, getClosedStockQty);
}

function summarizeDetailStockMaterials(rows) {
  return summarizeByMaterial(rows, getDetailMaterialCode, getDetailMaterialName, getDetailStockQty);
}

function summarizeSalesMaterials(rows) {
  return summarizeByMaterial(rows, getSalesMaterialCode, getSalesMaterialName, getSalesQty);
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

function summarizeSalesCustomerMaterialMissing(rows, customerMaterialKeys, productMap) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row) || getSalesStoreName(row);
    if (!materialCode || !customer) continue;
    const key = makeCustomerMaterialKey(customer, materialCode);
    if (customerMaterialKeys.has(key)) continue;
    const mapKey = `${normalizeStoreName(customer)}|${materialCode}`;
    if (!map.has(mapKey)) {
      map.set(mapKey, {
        customer,
        materialCode,
        sku: normalizeText(firstValue(row, ["SKU"])),
        materialName: getSalesMaterialName(row),
        qty: 0
      });
    }
    const item = map.get(mapKey);
    item.qty += getSalesQty(row);
    if (!item.materialName) item.materialName = getSalesMaterialName(row);
  }
  return [...map.values()]
    .map((item) => enrichSalesCustomerRow(item, productMap))
    .sort((a, b) => b.qty - a.qty || a.customer.localeCompare(b.customer, "zh-CN") || a.materialCode.localeCompare(b.materialCode, "zh-CN"));
}

function summarizeSalesStoreMissing(rows, storeNames) {
  const map = new Map();
  for (const row of rows) {
    const store = getSalesStoreNameForStoreSummary(row);
    if (!store) continue;
    const normalized = normalizeStoreName(store);
    if (storeNames.has(normalized)) continue;
    const key = normalized;
    if (!map.has(key)) map.set(key, { store, normalized, qty: 0 });
    map.get(key).qty += getSalesReceivableQty(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.store.localeCompare(b.store, "zh-CN"));
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

function mapCustomerMaterialKeys(rows) {
  const set = new Set();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ["物料编码", "货品编码", "商品编码", "SKU"]),
      nthValue(row, 2),
      nthValue(row, 3)
    ]));
    const customer = normalizeText(firstText([
      firstValue(row, ["客户", "客户名称", "渠道", "店铺", "店铺名称", "店铺简称", "简称", "金蝶客户", "领星客户"]),
      nthValue(row, 1)
    ]));
    const explicitKey = normalizeCustomerMaterialKey(firstText([
      firstValue(row, ["匹配键", "客户物料键", "客户物料匹配键", "客户+物料", "店铺物料键"])
    ]));
    if (explicitKey) set.add(explicitKey);
    if (materialCode && customer) set.add(makeCustomerMaterialKey(customer, materialCode));
  }
  return set;
}

function mapStoreNames(rows) {
  const map = new Map();
  for (const row of rows) {
    const candidates = [
      nthValue(row, 2),
      firstValue(row, ["金蝶", "金蝶名称", "店铺名称", "店铺", "客户名称", "客户", "公司名称", "全称"])
    ];
    for (const candidate of candidates) {
      const raw = normalizeText(candidate);
      const value = normalizeStoreName(raw);
      if (value && !map.has(value)) map.set(value, raw);
    }
  }
  return map;
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

function enrichSalesCustomerRow(item, productMap) {
  const product = productMap.get(item.materialCode) || {};
  return {
    customer: item.customer,
    materialCode: item.materialCode,
    sku: item.sku || product.sku || "",
    materialName: item.materialName || product.materialName || "",
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

function renderSalesCheckGroup(result) {
  $("#salesRowCount").textContent = formatNumber(result.salesRows.length);
  $("#salesStockMaterialCount").textContent = formatNumber(result.stockMaterials.length);
  $("#salesProductMissingCount").textContent = formatNumber(result.productMissing.length);
  $("#salesCustomerMaterialMissingCount").textContent = formatNumber(result.customerMaterialMissing.length);
  $("#salesStoreMissingCount").textContent = formatNumber(result.storeMissing.length);
  renderRows("#salesProductMissingRows", result.productMissing);
  renderSalesCustomerRows("#salesCustomerMaterialMissingRows", result.customerMaterialMissing);
  renderSalesStoreRows("#salesStoreMissingRows", result.storeMissing);
  renderSalesStoreDiagnostic(result.storeDiagnostic);
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

function renderSalesCustomerRows(selector, rows) {
  const tbody = $(selector);
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.sku)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty">暂无缺失数据</td></tr>`;
}

function renderSalesStoreRows(selector, rows) {
  const tbody = $(selector);
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.store)}</td>
      <td class="num">${formatNumber(row.qty)}</td>
    </tr>
  `).join("") : `<tr><td colspan="2" class="empty">暂无缺失数据</td></tr>`;
}

function renderSalesStoreDiagnostic(diagnostic = {}) {
  const panel = $("#salesStoreDiagnostic");
  if (!panel) return;
  const invalidNotice = diagnostic.storeSummaryValid === false
    ? `<span class="error-text">当前店铺名称汇总文件引用的 sheet 是「${escapeHtml(diagnostic.storeSheetName || "-")}」，B列表头是「${escapeHtml(diagnostic.storeHeaderB || "-")}」。正确口径应为 sheet「Dim-店铺名称汇总（金蝶&领星&简称）」、B列「金蝶名称」。请在维度表文件库重新上传或重新应用店铺名称汇总文件后再检查。</span>`
    : "";
  panel.innerHTML = `
    <span>客户名称来源：销售数据文件 B列（客户名称）</span>
    <span>数量来源：销售数据文件 I列（应收数量）</span>
    <span>比对维表：月度维度表文件库 - 店铺名称汇总（金蝶&领星&简称）</span>
    <span>比对列：Dim-店铺名称汇总（金蝶&领星&简称） B列（金蝶名称）</span>
    <span>缺失提示：销售数据文件 B列客户名称有、维表 B列金蝶名称没有的信息会列在下方</span>
    <span>需要维护：月度维度表文件库的店铺名称汇总（金蝶&领星&简称）</span>
    ${invalidNotice}
  `;
}

function downloadAllErrorTables() {
  if (typeof XLSX === "undefined") {
    window.alert("下载组件未加载，请刷新页面后重试。");
    return;
  }
  const stamp = downloadTimestamp();
  downloadCheckGroup("closed", stamp, currentErrorTables.closed);
  downloadCheckGroup("detail", stamp, currentErrorTables.detail);
  downloadCheckGroup("sales", stamp, currentErrorTables.sales);
}

const ERROR_DOWNLOAD_CONFIG = {
  productMissing: {
    sources: ["closed", "detail", "sales"],
    name: "商品维度缺失表",
    columns: [
      ["materialCode", "物料编码"],
      ["sku", "SKU"],
      ["materialName", "物料名称"],
      ["qty", "数量"]
    ]
  },
  divisionMissing: {
    sources: ["closed", "detail"],
    name: "仓库与物料维度表缺失",
    columns: [
      ["materialCode", "物料编码"],
      ["sku", "SKU"],
      ["materialName", "物料名称"],
      ["qty", "数量"]
    ]
  },
  warehouseMissing: {
    sources: ["closed", "detail"],
    name: "仓库名称",
    columns: [
      ["warehouse", "仓库"],
      ["qty", "数量"]
    ]
  },
  settlementMissing: {
    sources: ["closed", "detail"],
    name: "结算价缺失表",
    columns: [
      ["materialCode", "物料编码"],
      ["materialName", "物料名称"],
      ["productLine", "销售产品线"],
      ["qty", "数量"]
    ]
  },
  customerMaterialMissing: {
    sources: ["sales"],
    name: "客户与物料对照缺失表",
    columns: [
      ["customer", "客户/店铺"],
      ["materialCode", "物料编码"],
      ["sku", "SKU"],
      ["materialName", "物料名称"],
      ["qty", "数量"]
    ]
  },
  storeMissing: {
    sources: ["sales"],
    name: "店铺名称汇总缺失表",
    columns: [
      ["store", "客户名称"],
      ["normalized", "规范化客户名称"],
      ["qty", "数量"]
    ]
  }
};

function downloadSingleErrorTable(key) {
  if (typeof XLSX === "undefined") {
    window.alert("下载组件未加载，请刷新页面后重试。");
    return;
  }
  const [source, tableName] = String(key || "").split(".");
  const result = currentErrorTables[source];
  const config = ERROR_DOWNLOAD_CONFIG[tableName];
  if (!result || !config || !config.sources.includes(source)) {
    window.alert("未找到对应的报错明细。");
    return;
  }
  downloadRowsAsWorkbook(`${errorSourceLabel(source)}-${config.name}`, downloadTimestamp(), result[tableName] || [], config.columns);
}

function downloadCheckGroup(source, stamp, result) {
  for (const [tableName, config] of Object.entries(ERROR_DOWNLOAD_CONFIG)) {
    if (!config.sources.includes(source)) continue;
    downloadRowsAsWorkbook(`${errorSourceLabel(source)}-${config.name}`, stamp, result[tableName] || [], config.columns);
  }
}

function errorSourceLabel(source) {
  return {
    closed: "关账后库存事实表",
    detail: "库存分析月份表",
    sales: "销售数据文件"
  }[source] || "报错信息";
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

function getSalesMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ["物料编码", "货品编码", "商品编码", "产品编码", "SKU", "MSKU", "SellerSKU", "平台SKU"]),
    firstValueByHeaderIncludes(row, ["物料", "编码"]),
    firstValueByHeaderIncludes(row, ["商品", "编码"]),
    nthValue(row, 1)
  ]));
}

function getSalesMaterialName(row) {
  return normalizeText(firstText([
    firstValue(row, ["物料名称", "货品名称", "商品名称", "产品名称", "金蝶名称", "品名"]),
    firstValueByHeaderIncludes(row, ["物料", "名称"]),
    firstValueByHeaderIncludes(row, ["商品", "名称"])
  ]));
}

function getSalesCustomerName(row) {
  return normalizeText(firstText([
    firstValue(row, ["客户", "客户名称", "渠道", "渠道名称", "销售渠道", "买家", "买家名称"]),
    firstValueByHeaderIncludes(row, ["客户"]),
    firstValueByHeaderIncludes(row, ["渠道"])
  ]));
}

function getSalesStoreName(row) {
  return normalizeText(firstText([
    firstValue(row, ["店铺", "店铺名称", "店铺简称", "平台店铺", "领星店铺", "金蝶店铺", "店铺名", "简称"]),
    firstValueByHeaderIncludes(row, ["店铺"]),
    firstValueByHeaderIncludes(row, ["简称"])
  ]));
}

function getSalesStoreNameForStoreSummary(row) {
  return normalizeText(nthValue(row, 2));
}

function getSalesReceivableQty(row) {
  return toNumber(nthValue(row, 9));
}

function getSalesQty(row) {
  const value = firstNumber([
    firstValue(row, ["销售数量", "销量", "数量", "订单数量", "发货数量", "出库数量", "已售数量", "件数"]),
    firstValueByHeaderIncludes(row, ["销售", "数量"]),
    firstValueByHeaderIncludes(row, ["订单", "数量"]),
    firstValueByHeaderIncludes(row, ["发货", "数量"]),
    firstValueByHeaderIncludes(row, ["出库", "数量"]),
    firstValueByHeaderIncludes(row, ["销量"])
  ]);
  return value > 0 ? value : 1;
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

function makeCustomerMaterialKey(customer, materialCode) {
  return normalizeCustomerMaterialKey(`${customer}${materialCode}`);
}

function normalizeCustomerMaterialKey(value) {
  return normalizeKey(value).replace(/&/g, "").toLowerCase();
}

function normalizeStoreName(value) {
  return normalizeKey(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[&＆]/g, "")
    .replace(/[()（）【】\[\]{}<>《》]/g, "")
    .replace(/[，,。.、；;：:\-_\s]/g, "")
    .toLowerCase();
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
  return result.productMissing.length
    + result.divisionMissing.length
    + result.warehouseMissing.length
    + result.settlementMissing.length
    + (result.customerMaterialMissing?.length || 0)
    + (result.storeMissing?.length || 0);
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
