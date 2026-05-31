const $ = (selector) => document.querySelector(selector);
const REPLACE_SECRET = "3.1415926";
let replacementEnabled = false;

document.addEventListener("DOMContentLoaded", async () => {
  await loadSharedLibrary({ statusEl: $("#sharedStatus") });
  bindToolbar();
  await renderLibrary();
});

function bindToolbar() {
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#applyAllBtn").addEventListener("click", refreshAll);
  $("#downloadSharedBtn").addEventListener("click", downloadSharedLibrary);
  $("#enableReplaceBtn").addEventListener("click", () => {
    const key = $("#unlockInput").value.trim();
    replacementEnabled = key === REPLACE_SECRET;
    $("#permissionStatus").textContent = replacementEnabled ? "已启用秘钥替换权限" : "验证秘钥不正确";
    renderLibrary();
  });
}

async function refreshAll() {
  await loadSharedLibrary({ statusEl: $("#sharedStatus") });
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  const count = pageSlots().filter((slot) => records[slot.id]).length;
  if (!count) {
    await renderLibrary();
    return;
  }
  if (!window.confirm(`确认应用刷新 ${count} 个已上传文件？`)) return;
  const appliedAt = new Date().toISOString();
  for (const slot of pageSlots()) {
    if (records[slot.id]) {
      await saveRecord({ ...records[slot.id], appliedAt });
    }
  }
  await renderLibrary();
}

function pageType() {
  return document.body.dataset.libraryType;
}

function pageSlots() {
  return ALL_SLOTS.filter((slot) => slot.type === pageType());
}

function pageLabels() {
  const isDimension = pageType() === "dimension";
  return {
    eyebrow: isDimension ? "DIMENSION FILES" : "FACT FILES",
    summaryTitle: isDimension ? "月度维度表文件库" : "月度备货事实表库",
    slotLabel: isDimension ? "DIMENSION SLOT" : "FACT SLOT",
    emptyAction: isDimension ? "上传维度文件" : "上传事实表文件",
    savedLabel: isDimension ? "维度文件已保存" : "事实表已保存"
  };
}

async function renderLibrary() {
  const slots = pageSlots();
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  const used = slots.filter((slot) => records[slot.id]).length;
  const applied = slots.filter((slot) => records[slot.id]?.appliedAt).length;
  const latest = latestSavedAt(slots, records);
  const labels = pageLabels();

  $("#libraryEyebrow").textContent = labels.eyebrow;
  $("#libraryTitle").textContent = labels.summaryTitle;
  $("#savedBadge").textContent = labels.savedLabel;
  $("#slotLimit").textContent = slots.length;
  $("#uploadedCount").textContent = used;
  $("#appliedCount").textContent = applied;
  $("#latestUpdate").textContent = latest ? new Date(latest).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(/\//g, "/") : "-";

  $("#libraryGrid").innerHTML = slots.map((slot) => renderCard(slot, records[slot.id], labels)).join("");
  bindCardEvents();
}

function latestSavedAt(slots, records) {
  const times = slots
    .map((slot) => records[slot.id]?.savedAt)
    .filter(Boolean)
    .map((item) => Date.parse(item))
    .filter((item) => Number.isFinite(item));
  return times.length ? Math.max(...times) : null;
}

function renderCard(slot, record, labels) {
  const stateClass = record?.appliedAt ? "applied" : (record ? "pending" : "empty");
  const stateText = record?.appliedAt ? "已应用" : (record ? "待应用" : "空");
  const fileName = record?.fileName || slot.expectedName;
  const month = record?.savedAt ? `${new Date(record.savedAt).getFullYear()}年${new Date(record.savedAt).getMonth() + 1}月` : "";
  const updateDate = record?.savedAt ? new Date(record.savedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) : "";

  if (!record) {
    return `
      <article class="library-card file-slot empty-card" data-slot-id="${slot.id}">
        <div class="slot-head">
          <span class="slot-kicker">${labels.slotLabel}</span>
          <span class="slot-state ${stateClass}">${stateText}</span>
        </div>
        <h2>${escapeHtml(slot.title)}</h2>
        <p class="slot-description">${escapeHtml(slot.description)}</p>
        <label class="drop-zone">
          <input class="slot-file-input" type="file" accept=".xlsx,.xlsm,.xls,.csv" data-file-input="${slot.id}">
          <strong>${labels.emptyAction}</strong>
          <span>刷新月份和更新日期会自动记录</span>
        </label>
        <div class="card-actions">
          <button type="button" data-save="${slot.id}">替换文件</button>
          <button class="secondary" type="button" data-apply="${slot.id}" disabled>应用刷新</button>
          <button class="danger" type="button" data-delete="${slot.id}" disabled>删除</button>
        </div>
        <p class="muted" id="status-${slot.id}"></p>
      </article>
    `;
  }

  return `
    <article class="library-card file-slot" data-slot-id="${slot.id}">
      <div class="slot-head">
        <span class="slot-kicker">${labels.slotLabel}</span>
        <span class="slot-state ${stateClass}">${stateText}</span>
      </div>
      <h2>${escapeHtml(slot.title)}</h2>
      <p class="slot-description">${escapeHtml(slot.description)}</p>
      <h3>${escapeHtml(fileName)}</h3>
      <p class="file-kind">Excel 工作簿 · ${formatFileSize(record.size || 0)}</p>
      <div class="slot-info">
        <span>刷新月份</span>
        <strong>${escapeHtml(month)}</strong>
      </div>
      <div class="slot-info">
        <span>更新日期</span>
        <strong>${escapeHtml(updateDate)}</strong>
      </div>
      <input class="slot-file-input" type="file" accept=".xlsx,.xlsm,.xls,.csv" data-file-input="${slot.id}">
      <div class="card-actions">
        <button type="button" data-save="${slot.id}" ${replacementEnabled ? "" : "disabled"}>替换文件</button>
        <button class="secondary" type="button" data-apply="${slot.id}">应用刷新</button>
        <button class="danger" type="button" data-delete="${slot.id}" ${replacementEnabled ? "" : "disabled"}>删除</button>
      </div>
      <p class="muted" id="status-${slot.id}"></p>
    </article>
  `;
}

function bindCardEvents() {
  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => chooseSlotFile(button.dataset.save));
  });
  document.querySelectorAll("[data-file-input]").forEach((input) => {
    input.addEventListener("change", () => saveSlot(input.dataset.fileInput));
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => clearSlot(button.dataset.delete));
  });
  document.querySelectorAll("[data-apply]").forEach((button) => {
    button.addEventListener("click", () => applySlot(button.dataset.apply));
  });
}

function chooseSlotFile(slotId) {
  const input = document.querySelector(`[data-file-input="${slotId}"]`);
  const status = $(`#status-${slotId}`);
  if (!input) return;
  input.value = "";
  status.textContent = "请选择要上传的 Excel 文件。";
  input.click();
}

async function saveSlot(slotId) {
  const slot = SLOT_BY_ID[slotId];
  const input = document.querySelector(`[data-file-input="${slotId}"]`);
  const status = $(`#status-${slotId}`);
  const file = input.files?.[0];
  if (!file) {
    status.textContent = "请先选择文件。";
    return;
  }

  try {
    status.textContent = "正在解析文件...";
    const record = await readExcelFile(file, slot);
    if (!record.rows.length) throw new Error("文件未解析到有效行。");
    const { appliedAt, ...pendingRecord } = record;
    await saveRecord(pendingRecord);
    status.textContent = "已保存到浏览器文件库，请点击应用刷新后生效。";
    await renderLibrary();
  } catch (error) {
    status.textContent = `解析失败：${error.message}`;
  }
}

async function applySlot(slotId) {
  const record = await getRecord(slotId);
  if (!record) return;
  if (!window.confirm(`确认应用刷新：${record.fileName || SLOT_BY_ID[slotId].title}？`)) return;
  await saveRecord({ ...record, appliedAt: new Date().toISOString() });
  await renderLibrary();
}

async function clearSlot(slotId) {
  await deleteRecord(slotId);
  await renderLibrary();
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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
