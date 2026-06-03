const TREND_MONTHS = [
  { id: "fact-3", label: "1月" },
  { id: "fact-4", label: "2月" },
  { id: "fact-5", label: "3月" },
  { id: "fact-6", label: "4月" }
];

const TREND_COLORS = ["#007aff", "#34c759", "#ff9f0a", "#af52de"];
const TREND_TOP_LIMIT = 8;

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.querySelector("#summaryStatus");
  await loadSharedLibrary({ statusEl });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  renderTrendDashboard(records);
});

function renderTrendDashboard(records) {
  const maps = buildTrendDimensionMaps(records);
  const monthSummaries = TREND_MONTHS.map((month) => summarizeTrendMonth(month, records[month.id], maps));
  const loaded = monthSummaries.filter((item) => item.record).length;
  const usedRows = monthSummaries.reduce((total, item) => total + item.usedRows, 0);
  const totalQty = monthSummaries.reduce((total, item) => total + item.totalQty, 0);

  setText("#summaryStatus", `已读取 ${loaded}/4 个月份文件，参与趋势计算 ${formatNumber(usedRows, 0)} 行，K列数量合计 ${formatQuantity(totalQty)}。`);
  renderVerticalTrendChart("departmentTrendChart", "departmentTrendTotal", monthSummaries, "department", "未匹配事业部");
  renderVerticalTrendChart("productTrendChart", "productTrendTotal", monthSummaries, "productLine", "未分类产品线");
  renderVerticalTrendChart("warehouseLocationTrendChart", "warehouseLocationTrendTotal", monthSummaries, "warehouseLocation", "未分类仓库位置");
  renderTrendSourcePanel(monthSummaries, records);
}

function summarizeTrendMonth(month, record, maps) {
  const rows = record?.rows || [];
  const summary = {
    ...month,
    record,
    totalRows: rows.length,
    usedRows: 0,
    totalQty: 0,
    items: []
  };

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialB = normalizeMaterialCode(nthValue(row, 2));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = trendToNumber(nthValue(row, 11));
    if (!qty) continue;

    const department = maps.departmentByKey.get(makeTrendDepartmentKey(materialA, warehouse, materialB)) || "";
    const productLine = maps.productLineByMaterial.get(materialB) || "";
    const warehouseLocation = maps.warehouseLocationByName.get(normalizeText(warehouse)) || "";
    summary.usedRows += 1;
    summary.totalQty += qty;
    summary.items.push({
      qty,
      department: department || "未匹配事业部",
      productLine: productLine || "未分类产品线",
      warehouseLocation: warehouseLocation || "未分类仓库位置"
    });
  }

  return summary;
}

function buildTrendDimensionMaps(records) {
  const departmentByKey = new Map();
  for (const row of records["dim-warehouse-material"]?.rows || []) {
    const key = normalizeTrendDepartmentKey(nthValue(row, 6));
    const department = normalizeText(nthValue(row, 7));
    if (key && department && !departmentByKey.has(key)) departmentByKey.set(key, department);
  }

  const warehouseLocationByName = new Map();
  for (const row of records["dim-warehouse"]?.rows || []) {
    const warehouseName = normalizeText(nthValue(row, 2));
    const warehouseLocation = normalizeText(nthValue(row, 8));
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) {
      warehouseLocationByName.set(warehouseName, warehouseLocation);
    }
  }

  const productLineByMaterial = new Map();
  for (const row of records["dim-product"]?.rows || []) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const productLine = normalizeText(nthValue(row, 7));
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) {
      productLineByMaterial.set(materialCode, productLine);
    }
  }

  return { departmentByKey, warehouseLocationByName, productLineByMaterial };
}

function renderVerticalTrendChart(chartId, totalId, monthSummaries, field, fallbackName) {
  const container = document.querySelector(`#${chartId}`);
  if (!container) return;
  const categoryNames = topTrendCategories(monthSummaries, field, fallbackName);
  const total = monthSummaries.reduce((sum, month) => sum + month.totalQty, 0);
  setText(`#${totalId}`, `合计 ${formatQuantity(total)}`);

  if (!categoryNames.length) {
    container.innerHTML = `<div class="empty">暂无趋势数据</div>`;
    return;
  }

  const valuesByCategory = categoryNames.map((name) => ({
    name,
    values: TREND_MONTHS.map((month) => getTrendMonthCategoryValue(monthSummaries, month.label, field, name, fallbackName))
  }));
  const max = Math.max(...valuesByCategory.flatMap((item) => item.values), 1);
  container.innerHTML = `
    <div class="trend-legend">
      ${TREND_MONTHS.map((month, index) => `<span><i style="background:${TREND_COLORS[index]}"></i>${month.label}</span>`).join("")}
    </div>
    <div class="trend-bars-vertical">
      ${valuesByCategory.map((category) => `
        <div class="trend-category" title="${escapeHtml(category.name)}">
          <div class="trend-bar-group">
            ${category.values.map((value, index) => `
              <div class="trend-bar-wrap" title="${TREND_MONTHS[index].label} ${escapeHtml(category.name)} ${formatQuantity(value)}">
                <span class="trend-bar-value">${escapeHtml(formatShortQuantity(value))}</span>
                <div class="trend-bar" style="height:${Math.max(2, value / max * 100)}%;background:${TREND_COLORS[index]}"></div>
              </div>
            `).join("")}
          </div>
          <div class="trend-category-label">${escapeHtml(category.name)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function topTrendCategories(monthSummaries, field, fallbackName) {
  const totals = new Map();
  for (const month of monthSummaries) {
    for (const item of month.items) {
      const name = normalizeText(item[field]) || fallbackName;
      totals.set(name, (totals.get(name) || 0) + item.qty);
    }
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TREND_TOP_LIMIT)
    .map(([name]) => name);
}

function getTrendMonthCategoryValue(monthSummaries, label, field, categoryName, fallbackName) {
  const month = monthSummaries.find((item) => item.label === label);
  if (!month) return 0;
  return month.items.reduce((total, item) => {
    const name = normalizeText(item[field]) || fallbackName;
    return name === categoryName ? total + item.qty : total;
  }, 0);
}

function renderTrendSourcePanel(monthSummaries, records) {
  const sourceEl = document.querySelector("#sourcePanel");
  if (!sourceEl) return;
  const monthLines = monthSummaries.map((item) => {
    const record = item.record;
    if (!record) return `<div>${item.label}：未引用</div>`;
    return `<div>${item.label}：${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}，${formatNumber(item.usedRows, 0)} 行</div>`;
  });
  const dimLines = [
    ["仓库物料事业部对照表", records["dim-warehouse-material"]],
    ["仓库、金蝶、旺店通、领星", records["dim-warehouse"]],
    ["商品分类维表", records["dim-product"]]
  ].map(([label, record]) => `<div>${label}：${record ? `${escapeHtml(record.fileName || "-")}，${formatRecordTime(record.appliedAt || record.savedAt)}` : "未引用"}</div>`);
  sourceEl.innerHTML = `
    <strong>趋势图口径</strong>
    <div>事实表取收发汇总表1月-4月，第4行为表头；数量取K列求和。</div>
    <div>事业部：事实表A列+D列+B列匹配仓库物料事业部对照表F列，取G列。</div>
    <div>产品：事实表B列匹配商品分类维表A列，取G列销售产品线。</div>
    <div>仓库位置：事实表D列匹配仓库维表B列，取H列仓库位置。</div>
    <strong>当前引用</strong>
    ${monthLines.join("")}
    ${dimLines.join("")}
  `;
}

function makeTrendDepartmentKey(materialA, warehouse, materialB) {
  return normalizeTrendDepartmentKey(`${materialA}${warehouse}${materialB}`);
}

function normalizeTrendDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, "").toLowerCase();
}

function trendToNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text || text.startsWith("#")) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function formatNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const abs = Math.abs(numeric);
  if (abs >= 10000) return `${formatNumber(numeric / 10000, 2)}万`;
  return formatNumber(numeric, 2);
}

function formatShortQuantity(value) {
  const numeric = Number(value) || 0;
  const abs = Math.abs(numeric);
  if (abs >= 10000) return `${formatNumber(numeric / 10000, 1)}万`;
  if (abs >= 1000) return formatNumber(numeric, 0);
  return formatNumber(numeric, 1);
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
