const $ = (selector) => document.querySelector(selector);
let summaryRows = [];
let filteredRows = [];

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", refreshSummary);
  $("#downloadBtn").addEventListener("click", downloadCurrentRows);
  $("#searchInput").addEventListener("input", renderSummary);
  $("#stockFilter").addEventListener("change", renderSummary);
  await refreshSummary();
});

async function refreshSummary() {
  await loadSharedLibrary({ statusEl: $("#summaryStatus") });
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const factRecord = records["fact-inventory"];
  renderSourcePanel(factRecord);
  if (!factRecord) {
    summaryRows = [];
    $("#summaryStatus").textContent = "缺少关账后库存事实表，请先到备货事实表库上传并应用。";
    renderSummary();
    return;
  }
  summaryRows = (factRecord.rows || []).map((row) => {
    const endingQty = parseNumberCell(nthValue(row, 7)).value;
    const trueCostPrice = parseNumberCell(nthValue(row, 8)).value;
    const trueCostAmount = parseNumberCell(nthValue(row, 9)).value;
    return {
      materialCode: normalizeText(nthValue(row, 1)),
      materialName: normalizeText(nthValue(row, 5)),
      warehouse: normalizeText(nthValue(row, 6)),
      organization: normalizeText(nthValue(row, 12)),
      endingQty,
      trueCostPrice,
      trueCostAmount
    };
  });
  $("#summaryStatus").textContent = `已读取 ${formatNumber(summaryRows.length, 0)} 行：${factRecord.fileName || "-"}`;
  renderSummary();
}

function renderSourcePanel(record) {
  if (!record) {
    $("#sourcePanel").innerHTML = "";
    return;
  }
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  $("#sourcePanel").innerHTML = `<div><strong>关账后库存事实表</strong>：${escapeHtml(record.fileName || "-")}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>IndexedDB: ${KC_DB_NAME}/${KC_STORE}/fact-inventory</code></div>`;
}

function renderSummary() {
  const query = normalizeKey($("#searchInput").value);
  const stockOnly = $("#stockFilter").value === "stock";
  filteredRows = summaryRows.filter((row) => {
    const hit = !query || [row.materialCode, row.materialName, row.warehouse, row.organization]
      .some((value) => normalizeKey(value).includes(query));
    return hit && (!stockOnly || row.endingQty !== 0);
  });
  $("#rowCount").textContent = formatNumber(filteredRows.length, 0);
  $("#qtyTotal").textContent = formatNumber(sum(filteredRows, "endingQty"), 3);
  $("#amountTotal").textContent = formatMoney(sum(filteredRows, "trueCostAmount"));
  const shown = filteredRows.slice(0, 1000);
  $("#summaryRows").innerHTML = shown.length ? shown.map((row) => `
    <tr>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.organization)}</td>
      <td class="num">${formatNumber(row.endingQty, 3)}</td>
      <td class="num">${formatNumber(row.trueCostPrice, 6)}</td>
      <td class="num">${formatMoney(row.trueCostAmount)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">暂无数据</td></tr>`;
}

function downloadCurrentRows() {
  const headers = ["物料编码", "物料名称", "仓库", "库存组织", "结存数量", "真实成本单价", "真实成本-货品"];
  const lines = [headers.join(",")];
  filteredRows.forEach((row) => {
    lines.push([
      row.materialCode,
      row.materialName,
      row.warehouse,
      row.organization,
      row.endingQty,
      row.trueCostPrice,
      row.trueCostAmount
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

function parseNumberCell(value) {
  const text = normalizeText(value);
  if (!text) return { valid: false, value: 0 };
  const cleaned = text.replace(/[,\s锟ヂュ厓￥¥]/g, "");
  if (!cleaned || /^#/.test(cleaned)) return { valid: false, value: 0 };
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false, value: 0 };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
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
