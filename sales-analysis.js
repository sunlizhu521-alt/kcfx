const $ = (selector) => document.querySelector(selector);
const COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de", "#ff375f", "#5ac8fa", "#5856d6", "#30d158", "#bf5af2", "#ff6b35"];

let salesRows = [];
let filteredRows = [];

document.addEventListener("DOMContentLoaded", async () => {
  $("#clearFiltersBtn")?.addEventListener("click", clearFilters);
  $("#downloadBtn")?.addEventListener("click", downloadCurrentRows);
  $("#searchInput")?.addEventListener("input", renderSalesAnalysis);
  document.addEventListener("click", closeMultiFilters);
  ["salesOrgFilter", "customerFilter", "productLineFilter", "materialFilter", "storeMatchFilter"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", renderSalesAnalysis);
  });
  await refreshSalesAnalysis();
});

async function refreshSalesAnalysis() {
  await loadSharedLibrary({ statusEl: $("#salesStatus") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const salesRecord = records["sales-data"];
  const productMap = mapProducts(records["dim-product"]?.rows || []);
  const storeNames = mapStoreNames(records["dim-customer-material"]);
  renderSourcePanel(salesRecord, records);
  if (!salesRecord) {
    salesRows = [];
    $("#salesStatus").textContent = "缺少销售数据文件，请先到销售数据文件页面上传并应用。";
    populateFilters([]);
    renderSalesAnalysis();
    return;
  }

  salesRows = (salesRecord.rows || []).map((row) => {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row);
    const product = productMap.get(materialCode) || {};
    const qty = getSalesReceivableQty(row);
    const storeMatched = customer ? storeNames.has(normalizeStoreNameForSales(customer)) : false;
    return {
      salesOrg: getSalesOrg(row),
      customer,
      materialCode,
      materialName: getSalesMaterialName(row) || product.materialName || "",
      productLine: product.productLine || "",
      qty,
      storeMatchStatus: storeMatched ? "已匹配" : "未匹配"
    };
  }).filter((row) => row.customer || row.materialCode || row.qty);

  populateFilters(salesRows);
  $("#salesStatus").textContent = buildStatusText(salesRecord, salesRows);
  renderSalesAnalysis();
}

function populateFilters(rows) {
  fillSelect($("#salesOrgFilter"), "全部销售组织", uniqueValues(rows, "salesOrg"));
  fillSelect($("#customerFilter"), "全部客户名称", uniqueValues(rows, "customer").slice(0, 300));
  fillSelect($("#productLineFilter"), "全部销售产品线", uniqueValues(rows, "productLine"));
  fillSelect($("#materialFilter"), "全部物料编码", uniqueValues(rows, "materialCode").slice(0, 300));
  fillSelect($("#storeMatchFilter"), "全部匹配状态", ["已匹配", "未匹配"].filter((value) => rows.some((row) => row.storeMatchStatus === value)));
}

function renderSalesAnalysis() {
  const search = normalizeText($("#searchInput")?.value || "").toLowerCase();
  filteredRows = salesRows.filter((row) => {
    if (!matchesFilter(row.salesOrg, $("#salesOrgFilter"))) return false;
    if (!matchesFilter(row.customer, $("#customerFilter"))) return false;
    if (!matchesFilter(row.productLine, $("#productLineFilter"))) return false;
    if (!matchesFilter(row.materialCode, $("#materialFilter"))) return false;
    if (!matchesFilter(row.storeMatchStatus, $("#storeMatchFilter"))) return false;
    if (search) {
      const haystack = [row.customer, row.materialCode, row.materialName, row.salesOrg].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  renderMetrics(filteredRows);
  renderBars("customerQtyChart", groupSum(filteredRows, "customer", 10), "customerQtyTotal");
  renderBars("salesOrgQtyChart", groupSum(filteredRows, "salesOrg", 10), "salesOrgQtyTotal");
  renderBars("productLineQtyChart", groupSum(filteredRows, "productLine", 10), "productLineQtyTotal");
  renderBars("materialQtyChart", groupSum(filteredRows, "materialCode", 10), "materialQtyTotal");
  renderBars("storeMatchQtyChart", groupSum(filteredRows, "storeMatchStatus", 5), "storeMatchQtyTotal");
  renderTable(filteredRows);
}

function renderMetrics(rows) {
  $("#salesRowTotal").textContent = formatNumber(rows.length, 0);
  $("#salesQtyTotal").textContent = formatQuantity(sum(rows, "qty"));
  $("#customerTotal").textContent = formatNumber(uniqueValues(rows, "customer").length, 0);
  $("#materialTotal").textContent = formatNumber(uniqueValues(rows, "materialCode").length, 0);
  $("#storeMissingTotal").textContent = formatNumber(rows.filter((row) => row.storeMatchStatus === "未匹配").length, 0);
}

function renderTable(rows) {
  const tbody = $("#salesRows");
  if (!tbody) return;
  const visible = rows.slice(0, 300);
  tbody.innerHTML = visible.length ? visible.map((row) => `
    <tr>
      <td>${escapeHtml(row.salesOrg)}</td>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.productLine)}</td>
      <td class="num">${formatQuantity(row.qty)}</td>
      <td>${escapeHtml(row.storeMatchStatus)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">暂无数据</td></tr>`;
}

function renderBars(id, rows, totalId = "") {
  const container = $(`#${id}`);
  if (!container) return;
  const total = rows.reduce((sumValue, row) => sumValue + row.value, 0);
  const totalEl = totalId ? $(`#${totalId}`) : null;
  if (totalEl) totalEl.textContent = `合计 ${formatQuantity(total)}`;
  if (!rows.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row, index) => {
    const width = Math.max(2, row.value / max * 100);
    const valueText = `${formatQuantity(row.value)}（${formatPercent(row.value, total)}）`;
    return `
      <div class="bar-row" title="${escapeHtml(row.name)} ${escapeHtml(valueText)}">
        <div class="bar-label">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
        <div class="bar-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }).join("");
}

function groupSum(rows, key, limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || "未分类";
    map.set(name, (map.get(name) || 0) + (Number(row.qty) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, limit);
}

function clearFilters() {
  ["salesOrgFilter", "customerFilter", "productLineFilter", "materialFilter", "storeMatchFilter"].forEach((id) => clearSelect($(`#${id}`)));
  if ($("#searchInput")) $("#searchInput").value = "";
  renderSalesAnalysis();
}

function fillSelect(select, allLabel, values) {
  if (!select) return;
  const current = getSelectValues(select);
  const selectedValues = values.filter((value) => current.includes(value));
  select.dataset.allLabel = allLabel;
  select.innerHTML = `
    <button class="multi-filter-button" type="button" aria-haspopup="listbox" aria-expanded="false"><span></span></button>
    <div class="multi-filter-menu" role="listbox">
      <label class="multi-filter-option is-all">
        <input type="checkbox" value="" data-all="true" ${selectedValues.length ? "" : "checked"}>
        <span>全部</span>
      </label>
      ${values.map((value) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(value)}" ${selectedValues.includes(value) ? "checked" : ""}>
          <span>${escapeHtml(value)}</span>
        </label>
      `).join("")}
    </div>
  `;
  select.querySelector(".multi-filter-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMultiFilter(select);
  });
  select.querySelector(".multi-filter-menu")?.addEventListener("click", (event) => event.stopPropagation());
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

function getSelectValues(select) {
  if (!select) return [];
  return [...select.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function matchesFilter(value, select) {
  const selected = getSelectValues(select);
  return !selected.length || selected.includes(normalizeText(value));
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
  const values = getSelectValues(select);
  const allLabel = select.dataset.allLabel || "全部";
  if (!buttonText) return;
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

function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ["物料编码"]), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      materialName: normalizeText(firstText([firstValue(row, ["金蝶名称", "物料名称", "货品名称"]), nthValue(row, 4)])),
      productLine: normalizeText(firstText([firstValue(row, ["销售产品线", "产品线"]), nthValue(row, 7)]))
    });
  }
  return map;
}

function mapStoreNames(record) {
  const rows = record?.rows || [];
  const set = new Set();
  for (const row of rows) {
    const value = normalizeStoreNameForSales(firstText([nthValue(row, 2), firstValue(row, ["金蝶名称", "客户名称", "店铺名称"])]));
    if (value) set.add(value);
  }
  return set;
}

function getSalesOrg(row) {
  return normalizeText(firstText([firstValue(row, ["销售组织"]), nthValue(row, 1)]));
}

function getSalesCustomerName(row) {
  return normalizeText(firstText([
    firstValue(row, ["客户名称", "客户", "店铺名称", "店铺"]),
    nthValue(row, 2)
  ]));
}

function getSalesMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ["物料编码", "货品编码", "商品编码", "产品编码", "SKU", "MSKU"]),
    firstValueByHeaderIncludes(row, ["物料", "编码"]),
    nthValue(row, 3)
  ]));
}

function getSalesMaterialName(row) {
  return normalizeText(firstText([
    firstValue(row, ["物料名称", "货品名称", "商品名称", "产品名称", "金蝶名称", "品名"]),
    firstValueByHeaderIncludes(row, ["物料", "名称"])
  ]));
}

function getSalesReceivableQty(row) {
  const value = firstNumber([
    firstValue(row, ["应收数量", "销售数量", "数量", "出库数量"]),
    nthValue(row, 9)
  ]);
  return value;
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

function normalizeStoreNameForSales(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[&＆]/g, "")
    .replace(/[()（）【】\[\]{}<>《》]/g, "")
    .replace(/[，,。.、；;：:\-_\s]/g, "")
    .toLowerCase();
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatPercent(value, total) {
  const denominator = Number(total) || 0;
  if (!denominator) return "0.00%";
  return `${((Number(value) || 0) / denominator * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function buildStatusText(record, rows) {
  const appliedAt = record?.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  return `已读取 ${formatNumber(rows.length, 0)} 行销售数据；当前引用：${record?.fileName || "-"}（${appliedAt}）`;
}

function renderSourcePanel(record, records) {
  const panel = $("#sourcePanel");
  if (!panel) return;
  const salesRef = record ? `${record.fileName || "-"}；当前引用：${formatRecordTime(record.appliedAt || record.savedAt)}` : "未引用";
  const productRef = records["dim-product"] ? `${records["dim-product"].fileName || "-"}；${formatRecordTime(records["dim-product"].appliedAt || records["dim-product"].savedAt)}` : "未引用";
  const storeRef = records["dim-customer-material"] ? `${records["dim-customer-material"].fileName || "-"}；${formatRecordTime(records["dim-customer-material"].appliedAt || records["dim-customer-material"].savedAt)}` : "未引用";
  panel.innerHTML = `
    <div><strong>销售数据文件</strong>：${escapeHtml(salesRef)}</div>
    <div><strong>商品分类维表</strong>：${escapeHtml(productRef)}</div>
    <div><strong>店铺名称汇总（金蝶&领星&简称）</strong>：${escapeHtml(storeRef)}</div>
  `;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function downloadCurrentRows() {
  const header = ["销售组织", "客户名称", "物料编码", "物料名称", "销售产品线", "应收数量", "店铺名称汇总匹配"];
  const lines = [header, ...filteredRows.map((row) => [
    row.salesOrg,
    row.customer,
    row.materialCode,
    row.materialName,
    row.productLine,
    row.qty,
    row.storeMatchStatus
  ])].map((line) => line.map(csvCell).join(","));
  downloadCsv(`销售数据分析_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.csv`, lines);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(fileName, lines) {
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
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
