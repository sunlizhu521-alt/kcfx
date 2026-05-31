const COLORS = ["#0f7b79", "#405c9a", "#2f8f5b", "#b87618", "#6c5ce7", "#d35400", "#2980b9", "#7f8c8d"];
let wideRows = [];
let filteredRows = [];
let dashboardDiagnostics = {};
const DASHBOARD_REQUIRED_SLOTS = ["fact-inventory", "dim-product", "dim-warehouse", "dim-warehouse-material"];

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSharedLibrary({ statusEl: $("#sharedStatus") });
  $("#refreshBtn").addEventListener("click", refreshDashboard);
  ["priceBasisFilter", "departmentFilter", "productLineFilter", "seriesFilter", "warehouseTypeFilter", "warehouseLocationFilter", "searchInput"].forEach((id) => {
    $(`#${id}`).addEventListener(id === "searchInput" ? "input" : "change", renderDashboard);
  });
  await refreshDashboard();
});

async function refreshDashboard() {
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  const missing = DASHBOARD_REQUIRED_SLOTS.map((id) => SLOT_BY_ID[id]).filter((slot) => !records[slot.id]);
  if (missing.length) {
    $("#detailRows").innerHTML = `<tr><td colspan="12" class="empty">缺少文件：${missing.map((slot) => slot.title).join("、")}。请到文件库上传，或更新 data/shared-library.json。</td></tr>`;
    clearDashboard();
    return;
  }

  wideRows = buildWideRows(records);
  populateFilters(records);
  renderDashboard();
}

function buildWideRows(records) {
  const factRows = records["fact-inventory"].rows || [];
  const productRows = records["dim-product"].rows || [];
  const warehouseRows = records["dim-warehouse"].rows || [];
  const warehouseMaterialRows = records["dim-warehouse-material"].rows || [];

  const productByCode = new Map();
  const productHeaders = Object.keys(productRows[0] || {});
  dashboardDiagnostics = {
    productRows: productRows.length,
    productHasSettlementColumn: productHeaders.includes("结算价"),
    productHeaders: productHeaders.slice(0, 16),
    productCodeRows: 0,
    productSettlementRows: 0,
    productCodeSettlementRows: 0,
    factRows: factRows.length
  };
  for (const row of productRows) {
    const code = normalizeMaterialCode(firstValue(row, ["物料编码"]));
    const rawSettlementPrice = firstValue(row, ["结算价"]);
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
  for (const row of warehouseRows) {
    const name = normalizeText(firstValue(row, ["金蝶名称", "仓库名称"]));
    if (!name || warehouseByName.has(name)) continue;
    warehouseByName.set(name, {
      warehouseType: firstText(row, [firstValue(row, ["一级仓库分类", "仓库类型", "财务维度仓库类型", "财务仓库类型"]), nthValue(row, 7)]),
      warehouseLocation: firstText(row, [firstValue(row, ["二级仓库分类", "仓库位置", "位置"]), nthValue(row, 8)])
    });
  }

  const divisionByKey = new Map();
  for (const row of warehouseMaterialRows) {
    const key = makeJoinKey(row);
    if (!key || divisionByKey.has(key)) continue;
    divisionByKey.set(key, {
      department: firstText(row, [firstValue(row, ["事业部", "销售事业部", "部门"]), nthValue(row, 7)])
    });
  }

  return factRows.map((row) => {
    const materialCode = normalizeMaterialCode(firstValue(row, ["物料编码"]));
    const warehouse = normalizeText(firstValue(row, ["仓库名称", "金蝶名称", "仓库"]));
    const organization = normalizeText(firstValue(row, ["库存组织"]));
    const hasProductMatch = productByCode.has(materialCode);
    const product = productByCode.get(materialCode) || {};
    const warehouseInfo = warehouseByName.get(warehouse) || {};
    const division = divisionByKey.get(makeJoinKey(row)) || {};
    const financialPrice = firstNumber(row, [nthValue(row, 8), firstValue(row, ["真实成本单价", "期末库存真实成本", "成本单价", "单价"])]);
    const settlementPrice = product.settlementPrice || 0;
    const endingQty = toNumber(firstValue(row, ["(结存)数量（库存）", "结存数量", "库存数量"]));

    return {
      department: division.department || "未分部仓",
      productLine: product.productLine || "其他产品线",
      series: product.series || "常规系列",
      warehouse,
      organization,
      materialCode,
      sku: product.sku || "",
      materialName: product.materialName || normalizeText(firstValue(row, ["物料名称", "金蝶名称"])),
      warehouseType: warehouseInfo.warehouseType || "其他仓库类型",
      warehouseLocation: warehouseInfo.warehouseLocation || "其他仓库位置",
      beginningQty: toNumber(firstValue(row, ["(期初)数量（库存）", "期初数量"])),
      inboundQty: toNumber(firstValue(row, ["(收入)数量（库存）", "收入数量", "入库数量"])),
      outboundQty: toNumber(firstValue(row, ["(发出)数量（库存）", "发出数量", "出库数量"])),
      endingQty,
      financialPrice,
      settlementPrice,
      hasProductMatch,
      price: financialPrice,
      inventoryValue: endingQty * financialPrice
    };
  });
}

function populateFilters(records) {
  const productRows = records["dim-product"].rows || [];
  const warehouseRows = records["dim-warehouse"].rows || [];
  const warehouseMaterialRows = records["dim-warehouse-material"].rows || [];

  fillStaticSelect($("#priceBasisFilter"), [
    ["financial", "财务维度"],
    ["settlement", "结算价维度"]
  ]);
  fillSelect($("#departmentFilter"), "全部事业部", uniqueColumnValues(warehouseMaterialRows, ["事业部"]));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueColumnValues(productRows, ["销售产品线"]));
  fillSelect($("#seriesFilter"), "全部销售系列", uniqueColumnValues(productRows, ["销售系列"]));
  fillSelect($("#warehouseTypeFilter"), "全部仓库类型", uniqueColumnValues(warehouseRows, ["一级仓库分类"]));
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

function renderDashboard() {
  const priceBasis = $("#priceBasisFilter").value || "financial";
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
  renderMetrics(filteredRows);
  renderBars("departmentChart", groupSum(filteredRows, "department", "inventoryValue"), "wan");
  renderBars("productLineChart", groupSum(filteredRows, "productLine", "inventoryValue"), "wan");
  renderBars("warehouseTypeChart", groupSum(filteredRows, "warehouseType", "inventoryValue"), "wan");
  renderBars("seriesChart", groupSum(filteredRows, "series", "inventoryValue", 10), "wan");
  renderDetail(filteredRows);
}

function renderChartTitles(priceBasis) {
  const settlementMode = priceBasis === "settlement";
  $("#departmentChartTitle").textContent = settlementMode ? "事业部库存资金（万元）" : "事业部库存资产排行（万元）";
  $("#productLineChartTitle").textContent = settlementMode ? "销售产品线库存资金（万元）" : "销售产品线库存资产排行（万元）";
  $("#warehouseTypeChartTitle").textContent = settlementMode ? "仓库类型资金" : "仓库类型资金占用（万元）";
  $("#seriesChartTitle").textContent = settlementMode ? "产品系列 资金Top 10（万元）" : "产品系列 Top 10（万元）";
}

function renderPriceBasisStatus(priceBasis, rows) {
  if (priceBasis !== "settlement") {
    $("#sharedStatus").textContent = `财务维度：${formatNumber(rows.length, 0)} 行，按真实成本单价计算。`;
    $("#diagnosticPanel").classList.remove("show");
    $("#diagnosticPanel").textContent = "";
    return;
  }
  const pricedRows = rows.filter((row) => row.settlementPrice > 0 && row.endingQty !== 0);
  const matchedRows = rows.filter((row) => row.hasProductMatch && row.endingQty !== 0);
  const amount = sum(rows, "inventoryValue");
  $("#sharedStatus").textContent = `结算价维度：${formatNumber(rows.length, 0)} 行，结算价有效 ${formatNumber(pricedRows.length, 0)} 行，金额 ${formatMoney(amount)}。`;
  $("#diagnosticPanel").classList.add("show");
  $("#diagnosticPanel").textContent = [
    `诊断：商品维表 ${formatNumber(dashboardDiagnostics.productRows, 0)} 行，${dashboardDiagnostics.productHasSettlementColumn ? "已找到“结算价”列" : "未找到精确“结算价”列"}`,
    `有物料编码 ${formatNumber(dashboardDiagnostics.productCodeRows, 0)} 行，有结算价 ${formatNumber(dashboardDiagnostics.productSettlementRows, 0)} 行，物料编码+结算价同时有效 ${formatNumber(dashboardDiagnostics.productCodeSettlementRows, 0)} 行`,
    `事实表 ${formatNumber(dashboardDiagnostics.factRows, 0)} 行，当前筛选 ${formatNumber(rows.length, 0)} 行，匹配商品维表 ${formatNumber(matchedRows.length, 0)} 行，匹配且有结算价 ${formatNumber(pricedRows.length, 0)} 行`
  ].join("；");
}

function renderNoSettlementDataHint(rows) {
  return rows.length
    ? `<div class="empty">当前筛选下结算价金额为 0，请检查商品分类维表“结算价”列是否有值并已应用刷新。</div>`
    : `<div class="empty">暂无数据</div>`;
}

function applyPriceBasis(row, priceBasis) {
  const price = priceBasis === "settlement" ? row.settlementPrice : row.financialPrice;
  return {
    ...row,
    price,
    inventoryValue: row.endingQty * price
  };
}

function matchSelect(value, selected) {
  return !selected || value === selected;
}

function clearDashboard() {
  ["totalQty", "totalValue", "inboundQty", "outboundQty"].forEach((id) => {
    $(`#${id}`).textContent = id === "totalValue" ? "¥0" : "0";
  });
  ["departmentChart", "productLineChart", "warehouseTypeChart", "seriesChart"].forEach((id) => {
    $(`#${id}`).innerHTML = `<div class="empty">暂无数据</div>`;
  });
}

function renderMetrics(rows) {
  $("#totalQty").textContent = formatNumber(sum(rows, "endingQty"), 0);
  $("#totalValue").textContent = formatMoney(sum(rows, "inventoryValue"));
  $("#inboundQty").textContent = formatNumber(sum(rows, "inboundQty"), 0);
  $("#outboundQty").textContent = formatNumber(sum(rows, "outboundQty"), 0);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
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
  if (mode === "wan" && total === 0 && ($("#priceBasisFilter").value || "financial") === "settlement") {
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

function renderDetail(rows) {
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
      <td class="num">${formatNumber(row.price, 4)}</td>
      <td class="num">${formatMoney(row.inventoryValue)}</td>
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
