const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSharedLibrary({ statusEl: $("#sharedStatus") });
  renderLibrary();
  $("#refreshBtn").addEventListener("click", async () => {
    await loadSharedLibrary({ statusEl: $("#sharedStatus") });
    renderLibrary();
  });
  $("#downloadSharedBtn").addEventListener("click", downloadSharedLibrary);
});

function pageSlots() {
  const type = document.body.dataset.libraryType;
  return ALL_SLOTS.filter((slot) => slot.type === type);
}

async function renderLibrary() {
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  $("#libraryGrid").innerHTML = pageSlots().map((slot) => renderCard(slot, records[slot.id])).join("");
  bindCardEvents();
}

function renderCard(slot, record) {
  const status = record
    ? `
      <div class="file-meta">
        <span>当前文件：${escapeHtml(record.fileName)}</span>
        <span>工作表：${escapeHtml(record.sheetName || "-")}</span>
        <span>行数：${formatNumber((record.rows || []).length)}</span>
        <span>更新时间：${new Date(record.savedAt).toLocaleString("zh-CN")}</span>
      </div>
    `
    : `<div class="file-meta"><span>尚未上传</span><span>期望文件：${escapeHtml(slot.expectedName)}</span></div>`;

  return `
    <article class="library-card" data-slot-id="${slot.id}">
      <h2>${escapeHtml(slot.title)}</h2>
      <p>${escapeHtml(slot.description)}</p>
      ${status}
      <input type="file" accept=".xlsx,.xlsm,.xls,.csv" data-file-input="${slot.id}">
      <div class="card-actions">
        <button type="button" data-save="${slot.id}">替换文件</button>
        <button class="danger" type="button" data-delete="${slot.id}" ${record ? "" : "disabled"}>清空</button>
      </div>
      <p class="muted" id="status-${slot.id}"></p>
    </article>
  `;
}

function bindCardEvents() {
  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => saveSlot(button.dataset.save));
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => clearSlot(button.dataset.delete));
  });
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
    await saveRecord(record);
    status.textContent = "已保存到浏览器文件库。";
    renderLibrary();
  } catch (error) {
    status.textContent = `解析失败：${error.message}`;
  }
}

async function clearSlot(slotId) {
  await deleteRecord(slotId);
  renderLibrary();
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

