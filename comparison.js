const $ = (selector) => document.querySelector(selector);
const EPSILON = 0.000001;

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", runComparison);
  await loadSharedLibrary({ statusEl: $("#compareStatus") });
  await runComparison();
});

async function runComparison() {
  const records = Object.fromEntries((await getActiveRecords()).map((record) => [record.id, record]));
  const inventoryRecord = records["fact-inventory"];
  const detailRecord = records["fact-2"];

  renderSourcePanel(inventoryRecord, detailRecord);

  if (!inventoryRecord || !detailRecord) {
    $("#compareStatus").textContent = "缺少关账后库存事实表或收发明细汇总表，请先到备货事实表库上传并应用刷新。";
    renderMetrics({ inventoryQtyTotal: 0, detailQtyTotal: 0, qtyDiffTotal: 0, qtyDiffRows: [], priceDiffRows: [] });
    $("#matchBasis").textContent = "等待两张事实表应用后生成对比。";
    renderQtyRows([]);
    renderPriceRows([]);
    return;
  }

  const detailRows = detailRecord.rows || [];
  const inventoryRows = inventoryRecord.rows || [];
  const keyOptions = detectKeyOptions(inventoryRows, detailRows);
  const inventoryMap = summarizeInventoryRows(inventoryRows, keyOptions);
  const detailMap = summarizeDetailRows(detailRows, keyOptions);
  const comparison = compareMaps(inventoryMap, detailMap);

  renderMetrics(comparison);
  renderMatchBasis(keyOptions, inventoryRecord, detailRecord);
  renderQtyRows(comparison.qtyDiffRows);
  renderPriceRows(comparison.priceDiffRows);
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

function compareMaps(inventoryMap, detailMap) {
  const keys = new Set([...inventoryMap.keys(), ...detailMap.keys()]);
  const rows = [...keys].map((key) => {
    const inventory = inventoryMap.get(key) || {};
    const detail = detailMap.get(key) || {};
    const inventoryPrice = averagePrice(inventory.inventoryPriceAmount, inventory.inventoryPriceWeight);
    const detailPrice = averagePrice(detail.detailPriceAmount, detail.detailPriceWeight);
    return {
      key,
      organization: inventory.organization || detail.organization || "",
      warehouse: inventory.warehouse || detail.warehouse || "",
      materialCode: inventory.materialCode || detail.materialCode || "",
      materialName: inventory.materialName || detail.materialName || "",
      inventoryQty: inventory.inventoryQty || 0,
      detailQty: detail.detailQty || 0,
      qtyDiff: (inventory.inventoryQty || 0) - (detail.detailQty || 0),
      inventoryPrice,
      detailPrice,
      priceDiff: inventoryPrice - detailPrice
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
    qtyDiffRows,
    priceDiffRows
  };
}

function ensureItem(map, key, defaults) {
  if (!map.has(key)) {
    map.set(key, {
      ...defaults,
      inventoryQty: 0,
      detailQty: 0,
      inventoryPriceAmount: 0,
      inventoryPriceWeight: 0,
      detailPriceAmount: 0,
      detailPriceWeight: 0
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
  return firstNumber([
    firstValue(row, ["真实成本-货品", "真实成本单价", "期末库存真实成本"]),
    nthValue(row, 8)
  ]);
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

function renderMetrics(result) {
  $("#inventoryQtyTotal").textContent = formatNumber(result.inventoryQtyTotal, 3);
  $("#detailQtyTotal").textContent = formatNumber(result.detailQtyTotal, 3);
  $("#qtyDiffTotal").textContent = formatNumber(result.qtyDiffTotal, 3);
  $("#qtyDiffCount").textContent = formatNumber(result.qtyDiffRows.length, 0);
  $("#priceDiffCount").textContent = formatNumber(result.priceDiffRows.length, 0);
}

function renderMatchBasis(options, inventoryRecord, detailRecord) {
  const parts = ["物料编码"];
  if (options.useOrganization) parts.unshift("使用组织");
  if (options.useWarehouse) parts.splice(options.useOrganization ? 1 : 0, 0, "仓库");
  $("#matchBasis").textContent = [
    `匹配键：${parts.join(" + ")}`,
    `关账后库存事实表：结存数量取 G 列，真实成本-货品优先按列名识别，缺失时取 H 列。`,
    `收发明细汇总表：0430结余库存数量按列名识别，结算价(含税)固定取 P 列。`,
    `当前文件：${inventoryRecord.fileName || "-"} / ${detailRecord.fileName || "-"}`
  ].join(" ");
}

function renderSourcePanel(inventoryRecord, detailRecord) {
  const items = [
    sourceLine("关账后库存事实表", "fact-inventory", inventoryRecord),
    sourceLine("收发明细汇总表", "fact-2", detailRecord)
  ];
  $("#sourcePanel").innerHTML = items.join("");
}

function sourceLine(title, id, record) {
  if (!record) return `<div><strong>${escapeHtml(title)}</strong>：未应用</div>`;
  const savedAt = record.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const appliedAt = record.appliedAt ? new Date(record.appliedAt).toLocaleString("zh-CN", { hour12: false }) : "-";
  const path = `IndexedDB: kcfx-dashboard/files/${id}`;
  return `<div><strong>${escapeHtml(title)}</strong>：${escapeHtml(record.fileName || "-")}；行数：${formatNumber((record.rows || []).length, 0)}；保存：${escapeHtml(savedAt)}；当前引用：${escapeHtml(appliedAt)}；<code>${escapeHtml(path)}</code></div>`;
}

function renderQtyRows(rows) {
  const tbody = $("#qtyDiffRows");
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.inventoryQty, 3)}</td>
      <td class="num">${formatNumber(row.detailQty, 3)}</td>
      <td class="num">${formatNumber(row.qtyDiff, 3)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">暂无数量差异</td></tr>`;
}

function renderPriceRows(rows) {
  const tbody = $("#priceDiffRows");
  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.warehouse)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.materialName)}</td>
      <td class="num">${formatNumber(row.inventoryPrice, 4)}</td>
      <td class="num">${formatNumber(row.detailPrice, 4)}</td>
      <td class="num">${formatNumber(row.priceDiff, 4)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">暂无价格差异</td></tr>`;
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
