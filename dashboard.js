const COLORS = ["#0f7b79", "#405c9a", "#2f8f5b", "#b87618", "#6c5ce7", "#d35400", "#2980b9", "#7f8c8d"];
let wideRows = [];
let filteredRows = [];
let dashboardDiagnostics = {};
let factReferenceDiagnostics = {};
let factEndingQtyTotal = 0;
let factFinancialQtyTotal = 0;
let factFinancialValueTotal = 0;
const DASHBOARD_REQUIRED_SLOTS = ["fact-inventory", "dim-product", "dim-warehouse", "dim-warehouse-material"];
const FINANCIAL_PRICE_HEADERS = [
  "真实成本单价",
  "期末库存真实成本",
  "期末库存真实成本单价",
  "集团期末库存真实成本",
  "真实成本",
  "成本单价"
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

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSharedLibrary({ statusEl: $("#sharedStatus") });
  $("#refreshBtn").addEventListener("click", clearFilters);
  ["priceBasisFilter", "departmentFilter", "productLineFilter", "seriesFilter", "warehouseTypeFilter", "warehouseLocationFilter", "searchInput"].forEach((id) => {
    $(`#${id}`).addEventListener(id === "searchInput" ? "input" : "change", renderDashboard);
  });
  await refreshDashboard();
});

async function refreshDashboard() {
  const allRecords = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const records = allRecords;
  const factRecord = allRecords["fact-inventory"];
  factReferenceDiagnostics = buildFactReferenceDiagnostics(factRecord);
  factEndingQtyTotal = sumFactEndingQty(factRecord?.rows || []);
  const financialTotals = sumFactFinancialTotals(factRecord?.rows || []);
  factFinancialQtyTotal = financialTotals.qty;
  factFinancialValueTotal = financialTotals.value;
  const missing = DASHBOARD_REQUIRED_SLOTS.map((id) => SLOT_BY_ID[id]).filter((slot) => !records[slot.id]);
  if (missing.length) {
    const message = `缺少文件：${missing.map((slot) => slot.title).join("、")}。请到文件库上传或替换文件。`;
    $("#sharedStatus").textContent = "看板数据未就绪";
    $("#detailRows").innerHTML = `<tr><td colspan="12" class="empty">${escapeHtml(message)}</td></tr>`;
    clearDashboard();
    renderFactOnlyMetrics();
    renderFactDiagnosticPanel();
    return;
  }

  wideRows = buildWideRows(records);
  populateFilters(records);
  renderDataSourcePanel(records);
  renderDashboard();
}

function clearFilters() {
  $("#priceBasisFilter").value = "settlement";
  $("#departmentFilter").value = "";
  $("#productLineFilter").value = "";
  $("#seriesFilter").value = "";
  $("#warehouseTypeFilter").value = "";
  $("#warehouseLocationFilter").value = "";
  $("#searchInput").value = "";
  renderDashboard();
}

function buildFactReferenceDiagnostics(record) {
  const rows = record?.rows || [];
  const firstRow = rows[0] || {};
  const headers = Object.keys(firstRow);
  const result = {
    fileName: record?.fileName || "-",
    savedAt: record?.savedAt || "",
    sharedSavedAt: record?.sharedSavedAt || "",
    rowCount: rows.length,
    materialRows: 0,
    gHeader: headers[6] || "-",
    hHeader: headers[7] || "-",
    iHeader: headers[8] || "-",
    gValidRows: 0,
    hValidRows: 0,
    iValidRows: 0,
    ghValidRows: 0,
    gSum: 0,
    iSum: 0,
    ghValue: 0,
    parseDiagnostics: record?.parseDiagnostics || null,
    path: record?.libraryPath || ""
  };
  for (const row of rows) {
    if (getFactMaterialCode(row)) result.materialRows += 1;
    const qty = parseNumberCell(nthValue(row, 7));
    const price = parseNumberCell(nthValue(row, 8));
    const amount = parseNumberCell(nthValue(row, 9));
    if (qty.valid) {
      result.gValidRows += 1;
      result.gSum += qty.value;
    }
    if (price.valid) result.hValidRows += 1;
    if (amount.valid) {
      result.iValidRows += 1;
      result.iSum += amount.value;
    }
    if (qty.valid && price.valid) {
      result.ghValidRows += 1;
      result.ghValue += qty.value * price.value;
    }
  }
  return result;
}

function buildWideRows(records) {
  const factRows = records["fact-inventory"].rows || [];
  const productRows = records["dim-product"].rows || [];
  const warehouseRows = records["dim-warehouse"].rows || [];
  const warehouseMaterialRows = records["dim-warehouse-material"].rows || [];
  const productByCode = new Map();
  const productHeaders = Object.keys(productRows[0] || {});
  const factHeaders = [...new Set(factRows.flatMap((row) => Object.keys(row)))];
  dashboardDiagnostics = {
    productRows: productRows.length,
    productHasSettlementColumn: productHeaders.some((header) => normalizeHeaderName(header) === normalizeHeaderName("结算价") || normalizeHeaderName(header) === normalizeHeaderName("结算价（含税）")),
    productHeaders: productHeaders.slice(0, 16),
    productCodeRows: 0,
    productSettlementRows: 0,
    productCodeSettlementRows: 0,
    factRows: factRows.length,
    factHasFinancialPriceColumn: factHeaders.some(isFinancialPriceHeader),
    factCodeRows: 0,
    factEndingQtyRows: 0,
    factEndingQtyTotal: 0,
    matchedRows: 0,
    pricedRows: 0
  };
  for (const row of productRows) {
    const code = normalizeMaterialCode(firstText(row, [firstValue(row, ["物料编码"]), nthValue(row, 1)]));
    const rawSettlementPrice = firstText(row, [firstValue(row, ["结算价", "结算价（含税）"]), firstValueByHeaderIncludes(row, ["结算价"]), nthValue(row, 10)]);
    const settlementPrice = toNumber(rawSettlementPrice);
    if (code) dashboardDiagnostics.productCodeRows += 1;
    if (settlementPrice > 0) dashboardDiagnostics.productSettlementRows += 1;
    if (code && settlementPrice > 0) dashboardDiagnostics.productCodeSettlementRows += 1;
    if (!code) continue;
    const current = productByCode.get(code) || {};
    productByCode.set(code, {
      materialCode: code,
      sku: current.sku || normalizeText(firstValue(row, ["SKU"])),
      materialName: current.materialName || normalizeText(firstValue(row, ["金蝶名称", "物料名称"])),
      productLine: current.productLine || firstText(row, [firstValue(row, ["销售产品线", "产品线"]), nthValue(row, 7)]),
      series: current.series || normalizeText(firstValue(row, ["销售系列", "系列"])),
      purchaseGroup: current.purchaseGroup || normalizeText(firstValue(row, ["采购分组"])),
      settlementPrice: current.settlementPrice > 0 ? current.settlementPrice : settlementPrice
    });
  }

  const warehouseByName = new Map();
  const departmentByWarehouseKey = new Map();
  for (const row of warehouseRows) {
    const name = normalizeText(nthValue(row, 2));
    if (name && !warehouseByName.has(name)) {
      warehouseByName.set(name, {
        warehouseType: normalizeText(firstValue(row, ["一级仓库分类"])),
        warehouseLocation: firstText(row, [firstValue(row, ["二级仓库分类", "仓库位置", "位置"]), nthValue(row, 8)])
      });
    }
  }

  for (const row of warehouseMaterialRows) {
    const departmentKey = makeWarehouseMaterialDepartmentKey(row);
    if (departmentKey && !departmentByWarehouseKey.has(departmentKey)) {
      departmentByWarehouseKey.set(departmentKey, {
        department: normalizeText(nthValue(row, 7))
      });
    }
  }

  return factRows.map((row) => {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const warehouse = normalizeText(nthValue(row, 6));
    const organization = normalizeText(nthValue(row, 12));
    const hasProductMatch = productByCode.has(materialCode);
    const product = productByCode.get(materialCode) || {};
    const warehouseInfo = warehouseByName.get(warehouse) || {};
    const division = departmentByWarehouseKey.get(makeWarehouseDepartmentKeyFromFact(row)) || {};
    const financialPrice = getFinancialPrice(row);
    const financialAmount = getFinancialAmount(row);
    const settlementPrice = product.settlementPrice || 0;
    const endingQty = getEndingQty(row);
    if (materialCode) dashboardDiagnostics.factCodeRows += 1;
    if (endingQty !== 0) dashboardDiagnostics.factEndingQtyRows += 1;
    dashboardDiagnostics.factEndingQtyTotal += endingQty;
    if (hasProductMatch && endingQty !== 0) dashboardDiagnostics.matchedRows += 1;
    if (settlementPrice > 0 && endingQty !== 0) dashboardDiagnostics.pricedRows += 1;

    return {
      department: division.department || "未分部仓",
      productLine: product.productLine || "其他产品线",
      series: product.series || "常规系列",
      warehouse,
      organization,
      materialCode,
      sku: product.sku || "",
      materialName: product.materialName || normalizeText(firstValue(row, ["物料名称", "金蝶名称"])),
      warehouseType: warehouseInfo.warehouseType || "",
      warehouseLocation: warehouseInfo.warehouseLocation || "其他仓库位置",
      beginningQty: toNumber(firstValue(row, ["(期初)数量（库存）", "期初数量"])),
      inboundQty: toNumber(firstValue(row, ["(收入)数量（库存）", "收入数量", "入库数量"])),
      outboundQty: toNumber(firstValue(row, ["(发出)数量（库存）", "发出数量", "出库数量"])),
      endingQty,
      financialPrice,
      financialAmount,
      settlementPrice,
      hasProductMatch,
      price: financialPrice,
      inventoryValue: financialAmount
    };
  });
}

function populateFilters(records) {
  const productRows = records["dim-product"].rows || [];
  const warehouseRows = records["dim-warehouse"].rows || [];
  const warehouseMaterialRows = records["dim-warehouse-material"].rows || [];
  fillStaticSelect($("#priceBasisFilter"), [
    ["settlement", "结算价维度"],
    ["financial", "财务维度"]
  ]);
  fillSelect($("#departmentFilter"), "\u5168\u90e8\u4e8b\u4e1a\u90e8", sortByPreferredOrder(uniquePhysicalColumnValues(warehouseMaterialRows, 7), DEPARTMENT_ORDER));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueColumnValues(productRows, ["销售产品线"]));
  fillSelect($("#seriesFilter"), "全部销售系列", uniqueColumnValues(productRows, ["销售系列"]));
  fillSelect($("#warehouseTypeFilter"), "库存全链路", uniqueColumnValues(warehouseRows, ["一级仓库分类"]));
  fillSelect($("#warehouseLocationFilter"), "全部仓库位置", uniqueColumnValues(warehouseRows, ["二级仓库分类"]));
}

function fillStaticSelect(select, options) {
  const current = select.value || options[0][0];
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  select.value = options.some(([value]) => value === current) ? current : options[0][0];
}

function fillSelect(select, allLabel, values) {
  const current = select.value || "";
  select.innerHTML = [`<option value="">${allLabel}</option>`, ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  select.value = values.includes(current) ? current : "";
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))]
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

function makeWarehouseDepartmentKeyFromFact(row) {
  return [
    normalizeText(nthValue(row, 12)),
    normalizeText(nthValue(row, 6)),
    normalizeMaterialCode(nthValue(row, 1))
  ].join("");
}

function makeWarehouseMaterialDepartmentKey(row) {
  return [
    normalizeText(nthValue(row, 1)),
    normalizeText(nthValue(row, 2)),
    normalizeMaterialCode(nthValue(row, 3))
  ].join("");
}

function renderDashboard() {
  const priceBasis = $("#priceBasisFilter").value || "settlement";
  filteredRows = wideRows.filter((row) => {
    const q = normalizeKey($("#searchInput").value);
    const textHit = !q || [row.department, row.warehouseType, row.warehouseLocation, row.productLine, row.series, row.warehouse, row.materialCode, row.sku, row.materialName]
      .some((value) => normalizeKey(value).includes(q));
    return textHit
      && matchSelect(row.department, $("#departmentFilter").value)
      && matchSelect(row.productLine, $("#productLineFilter").value)
      && matchSelect(row.series, $("#seriesFilter").value)
      && matchSelect(row.warehouseType, $("#warehouseTypeFilter").value)
      && matchSelect(row.warehouseLocation, $("#warehouseLocationFilter").value);
  }).map((row) => applyPriceBasis(row, priceBasis));

  renderChartTitles(priceBasis);
  renderPriceBasisStatus(priceBasis, filteredRows);
  renderMetrics(filteredRows, priceBasis);
  if (priceBasis === "financial" && !dashboardDiagnostics.factHasFinancialPriceColumn) {
    renderMissingFinancialPriceCharts();
  } else {
    renderBars("departmentChart", groupSum(filteredRows, "department", "inventoryValue"), "wan");
    renderBars("productLineChart", groupSum(filteredRows.filter((row) => row.productLine !== "健康办公"), "productLine", "inventoryValue"), "wan");
    renderBars("warehouseTypeChart", groupSum(filteredRows.filter((row) => row.warehouseType), "warehouseType", "inventoryValue"), "wan");
    renderBars("seriesChart", groupSum(filteredRows, "series", "inventoryValue", 10), "wan");
  }
  renderDetail(filteredRows, priceBasis);
}

function renderChartTitles(priceBasis) {
  const settlementMode = priceBasis === "settlement";
  $("#departmentChartTitle").textContent = settlementMode ? "事业部库存（万元）" : "事业部库存资产排行（万元）";
  $("#productLineChartTitle").textContent = settlementMode ? "销售产品线库存（万元）" : "销售产品线库存资产排行（万元）";
  $("#warehouseTypeChartTitle").textContent = settlementMode ? "仓库类型库存" : "仓库类型库存占用（万元）";
  $("#seriesChartTitle").textContent = settlementMode ? "产品系列 库存Top 10（万元）" : "产品系列 Top 10（万元）";
}

function renderDataSourcePanel(records) {
  const items = DASHBOARD_REQUIRED_SLOTS.map((id) => {
    const slot = SLOT_BY_ID[id];
    const record = records[id];
    if (!record) return `<div><strong>${escapeHtml(slot.title)}</strong>：未应用</div>`;
    const source = record.libraryPath ? "库存分析看板文件库 + 浏览器本地库" : record.sharedSavedAt ? "GitHub共享包 + 浏览器本地库" : "浏览器本地库";
    const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
    const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
    const path = `IndexedDB: ${KC_DB_NAME}/${KC_STORE}/${id}；GitHub: ${record.libraryPath || `data/kcfx-library/${slot.type === "fact" ? "fact" : "dimensions"}/${id}.json`}`;
    return `<div><strong>${escapeHtml(slot.title)}</strong>：${escapeHtml(record.fileName || "-")}；来源：${escapeHtml(source)}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>${escapeHtml(path)}</code></div>`;
  });
  $("#dataSourcePanel").innerHTML = items.join("");
}

function renderFactDiagnosticPanel(extraLines = []) {
  const panel = $("#diagnosticPanel");
  if (!panel) return;
  const savedAt = factReferenceDiagnostics.savedAt
    ? new Date(factReferenceDiagnostics.savedAt).toLocaleString("zh-CN", { hour12: false })
    : "-";
  const source = factReferenceDiagnostics.path ? "库存分析看板文件库 + 浏览器本地库" : "浏览器本地库";
  const parseDiagnostics = factReferenceDiagnostics.parseDiagnostics || {};
  const parsedHeaders = (parseDiagnostics.headerFirst12 || []).filter(Boolean).join(" / ");
  const gSamples = (parseDiagnostics.gSamples || []).map((item) => normalizeText(item) || "-").join(" / ");
  const hSamples = (parseDiagnostics.hSamples || []).map((item) => normalizeText(item) || "-").join(" / ");
  const lines = [
    `当前事实表引用：${factReferenceDiagnostics.fileName || "-"}`,
    `来源：${source}`,
    `保存时间：${savedAt}`,
    `解析Sheet：${parseDiagnostics.sheetName || "-"}`,
    `解析前12字段：${parsedHeaders || "-"}`,
    `行数：${formatNumber(factReferenceDiagnostics.rowCount || 0, 0)}`,
    `有物料编码行：${formatNumber(factReferenceDiagnostics.materialRows || 0, 0)}`,
    `G列：${factReferenceDiagnostics.gHeader || "-"}`,
    `H列：${factReferenceDiagnostics.hHeader || "-"}`,
    `I列：${factReferenceDiagnostics.iHeader || "-"}`,
    `G列样例：${gSamples || "-"}`,
    `H列样例：${hSamples || "-"}`,
    `G列有效行：${formatNumber(factReferenceDiagnostics.gValidRows || 0, 0)}`,
    `H列有效行：${formatNumber(factReferenceDiagnostics.hValidRows || 0, 0)}`,
    `I列有效行：${formatNumber(factReferenceDiagnostics.iValidRows || 0, 0)}`,
    `G列求和：${formatNumber(factReferenceDiagnostics.gSum || 0, 3)}`,
    `I列求和：${formatNumber(factReferenceDiagnostics.iSum || 0, 5)}`,
    `G×H金额：${formatMoney(factReferenceDiagnostics.ghValue || 0)}`,
    `引用路径：${factReferenceDiagnostics.path || "-"}`
  ];
  panel.classList.add("show");
  panel.innerHTML = [...lines, ...extraLines].map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

function renderPriceBasisStatus(priceBasis, rows) {
  if (priceBasis !== "settlement") {
    if (!dashboardDiagnostics.factHasFinancialPriceColumn) {
      $("#sharedStatus").textContent = "财务维度：关账后库存事实表缺少真实成本单价列，无法计算结存数量 × 真实成本单价。";
    } else {
      $("#sharedStatus").textContent = `财务维度：${formatNumber(rows.length, 0)} 行，金额 ${formatMoney(sum(rows, "inventoryValue"))}。`;
    }
    renderFactDiagnosticPanel();
    return;
  }
  const pricedRows = rows.filter((row) => row.settlementPrice > 0 && row.endingQty !== 0);
  const matchedRows = rows.filter((row) => row.hasProductMatch && row.endingQty !== 0);
  const amount = sum(rows, "inventoryValue");
  $("#sharedStatus").textContent = `结算价维度：${formatNumber(rows.length, 0)} 行，结算价有效 ${formatNumber(pricedRows.length, 0)} 行，金额 ${formatMoney(amount)}。`;
  renderFactDiagnosticPanel([
    `诊断：商品维表 ${formatNumber(dashboardDiagnostics.productRows, 0)} 行，${dashboardDiagnostics.productHasSettlementColumn ? "已找到“结算价”列" : "未找到精确“结算价”列"}`,
    `有物料编码 ${formatNumber(dashboardDiagnostics.productCodeRows, 0)} 行，有结算价 ${formatNumber(dashboardDiagnostics.productSettlementRows, 0)} 行，物料编码+结算价同时有效 ${formatNumber(dashboardDiagnostics.productCodeSettlementRows, 0)} 行`,
    `事实表有物料编码 ${formatNumber(dashboardDiagnostics.factCodeRows, 0)} 行，结存数量非 0 ${formatNumber(dashboardDiagnostics.factEndingQtyRows, 0)} 行，结存数量合计 ${formatNumber(dashboardDiagnostics.factEndingQtyTotal, 0)}`,
    `事实表 ${formatNumber(dashboardDiagnostics.factRows, 0)} 行，当前筛选 ${formatNumber(rows.length, 0)} 行，匹配商品维表 ${formatNumber(matchedRows.length, 0)} 行，匹配且有结算价 ${formatNumber(pricedRows.length, 0)} 行`
  ]);
}

function renderNoSettlementDataHint(rows) {
  return rows.length
    ? `<div class="empty">当前筛选下结算价金额为 0，请检查商品分类维表“结算价”列是否有值并已应用。</div>`
    : `<div class="empty">暂无数据</div>`;
}

function applyPriceBasis(row, priceBasis) {
  const price = priceBasis === "settlement" ? row.settlementPrice : row.financialPrice;
  const inventoryValue = priceBasis === "settlement" ? row.endingQty * price : row.financialAmount;
  return {
    ...row,
    price,
    inventoryValue
  };
}

function matchSelect(value, selected) {
  return !selected || value === selected;
}

function clearDashboard() {
  $("#totalQty").textContent = "0";
  $("#totalValue").textContent = "¥0";
  $("#financialFundWan").textContent = "0";
  $("#settlementFundWan").textContent = "0";
  ["departmentChart", "productLineChart", "warehouseTypeChart", "seriesChart"].forEach((id) => {
    $(`#${id}`).innerHTML = `<div class="empty">暂无数据</div>`;
  });
}

function renderFactOnlyMetrics() {
  $("#totalQty").textContent = formatQuantityWithYi(factEndingQtyTotal);
  $("#totalValue").textContent = formatMoneyWithYi(0);
  $("#financialFundWan").textContent = formatWanNumber(factFinancialValueTotal);
  $("#settlementFundWan").textContent = "0";
}

function renderMetrics(rows, priceBasis) {
  $("#financialFundWan").textContent = formatWanNumber(sum(rows, "financialAmount"));
  $("#settlementFundWan").textContent = formatWanNumber(sumSettlementValue(rows));
  if (priceBasis === "financial") {
    $("#totalQty").textContent = formatQuantityWithYi(factFinancialQtyTotal);
    $("#totalValue").textContent = formatMoneyWithYi(factFinancialValueTotal);
    return;
  }
  $("#totalQty").textContent = formatQuantityWithYi(factEndingQtyTotal);
  $("#totalValue").textContent = formatMoneyWithYi(sum(rows, "inventoryValue"));
}

function formatQuantityWithYi(value) {
  return `${formatNumber(value, 0)}（${formatNumber(Number(value || 0) / 100000000, 2)}亿）`;
}

function formatMoneyWithYi(value) {
  return `${formatMoney(value)}（${formatNumber(Number(value || 0) / 100000000, 2)}亿）`;
}

function formatWanNumber(value) {
  return formatNumber(Number(value || 0) / 10000, 2);
}

function sumSettlementValue(rows) {
  return rows.reduce((total, row) => total + (Number(row.endingQty) || 0) * (Number(row.settlementPrice) || 0), 0);
}

function sumFactEndingQty(factRows) {
  return factRows.reduce((total, row) => {
    const qty = parseNumberCell(getFinancialQtyCell(row));
    return total + (qty.valid ? qty.value : 0);
  }, 0);
}

function sumFactFinancialTotals(factRows) {
  return factRows.reduce((total, row) => {
    const qty = parseNumberCell(getFinancialQtyCell(row));
    const amount = parseNumberCell(getFinancialAmountCell(row));
    return {
      qty: total.qty + (qty.valid ? qty.value : 0),
      value: total.value + (amount.valid ? amount.value : 0)
    };
  }, { qty: 0, value: 0 });
}

function getFactMaterialCode(row) {
  return normalizeMaterialCode(nthValue(row, 1));
}

function getFinancialQtyCell(row) {
  return nthValue(row, 7);
}

function getEndingQty(row) {
  return parseNumberCell(getEndingQtyCell(row)).value;
}

function getEndingQtyCell(row) {
  return firstText(row, [
    firstValue(row, ["(结存)数量（库存）", "(结存)数量(库存)", "结存数量（库存）", "结存数量"]),
    firstValueByHeaderIncludes(row, ["结存", "数量"]),
    nthValue(row, 7)
  ]);
}

function getFinancialPrice(row) {
  return parseNumberCell(getFinancialPriceCell(row)).value;
}

function getFinancialPriceCell(row) {
  return nthValue(row, 8);
}

function getFinancialAmount(row) {
  return parseNumberCell(getFinancialAmountCell(row)).value;
}

function getFinancialAmountCell(row) {
  return nthValue(row, 9);
}

function isFinancialPriceHeader(header) {
  const normalized = normalizeHeaderName(header);
  if (FINANCIAL_PRICE_HEADERS.some((name) => normalized === normalizeHeaderName(name))) return true;
  return normalized.includes(normalizeHeaderName("真实")) && normalized.includes(normalizeHeaderName("成本"));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function parseNumberCell(value) {
  const text = normalizeText(value);
  if (!text) return { valid: false, value: 0 };
  const cleaned = text.replace(/[,\s￥¥元]/g, "");
  if (!cleaned || /^#/.test(cleaned)) return { valid: false, value: 0 };
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false, value: 0 };
}

function groupSum(rows, key, valueKey, limit = 12) {
  const map = new Map();
  for (const row of rows) {
    const name = row[key] || "未归类";
    map.set(name, (map.get(name) || 0) + (Number(row[valueKey]) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function formatWan(value) {
  return `${formatNumber(Number(value || 0) / 10000, 2)}万元`;
}

function renderBars(id, rows, mode) {
  const container = $(`#${id}`);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const total = rows.reduce((value, row) => value + (Number(row.value) || 0), 0);
  if (mode === "wan" && total === 0 && ($("#priceBasisFilter").value || "settlement") === "settlement") {
    container.innerHTML = renderNoSettlementDataHint(filteredRows);
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row, index) => {
    const width = Math.max(2, row.value / max * 100);
    const value = mode === "money" ? formatMoney(row.value) : mode === "wan" ? formatWan(row.value) : formatNumber(row.value, 0);
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(value)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(value)}</div>
      </div>
    `;
  }).join("");
}

function renderMissingFinancialPriceCharts() {
  ["departmentChart", "productLineChart", "warehouseTypeChart", "seriesChart"].forEach((id) => {
    $(`#${id}`).innerHTML = `<div class="empty">关账后库存事实表缺少真实成本单价列</div>`;
  });
}

function renderDetail(rows, priceBasis) {
  const financialPriceMissing = priceBasis === "financial" && !dashboardDiagnostics.factHasFinancialPriceColumn;
  const shown = rows.slice(0, 1000);
  $("#detailRows").innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.department)}</td>
      <td>${escapeHtml(row.warehouseType)}</td>
      <td>${escapeHtml(row.warehouseLocation)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td>${escapeHtml(row.series)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.sku)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.endingQty, 0)}</td>
      <td class="num">${financialPriceMissing ? "缺少单价" : formatNumber(row.price, 4)}</td>
      <td class="num">${financialPriceMissing ? "无法计算" : formatMoney(row.inventoryValue)}</td>
    </tr>
  `).join("") : `<tr><td colspan="12" class="empty">没有匹配数据</td></tr>`;
}

function firstText(row, candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return "";
}

function firstNumber(row, candidates) {
  for (const candidate of candidates) {
    const value = toNumber(candidate);
    if (value !== 0 || normalizeText(candidate) === "0") return value;
  }
  return 0;
}

function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  return Object.values(row)[index] ?? "";
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
