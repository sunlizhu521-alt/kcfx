const KC_FILE_LIBRARY_MANIFEST = "data/kcfx-library/manifest.json";

async function loadSharedLibrary(options = {}) {
  const statusEl = options.statusEl || null;
  return loadKcfxFileLibrary(statusEl);
}

async function loadKcfxFileLibrary(statusEl) {
  const cacheKey = `v=${Date.now()}`;
  try {
    const response = await fetch(`${KC_FILE_LIBRARY_MANIFEST}?${cacheKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const entries = Object.entries(manifest.records || {});
    let imported = 0;

    for (const [id, entry] of entries) {
      if (!SLOT_BY_ID[id] || !entry.path) continue;
      const recordResponse = await fetch(`${entry.path}?${cacheKey}`, { cache: "no-store" });
      if (!recordResponse.ok) throw new Error(`${entry.path} HTTP ${recordResponse.status}`);
      const record = await recordResponse.json();
      if (!Array.isArray(record.rows)) continue;
      const nextRecord = {
        ...record,
        id,
        appliedAt: entry.appliedAt || record.appliedAt || record.savedAt || manifest.savedAt || "",
        libraryPath: entry.path,
        libraryManifestPath: KC_FILE_LIBRARY_MANIFEST,
        sharedSavedAt: manifest.savedAt || record.savedAt || ""
      };
      const local = await getRecord(id);
      const shouldMigratePath = local
        && !hasPendingRecord(local)
        && (!local.libraryPath || local.libraryPath !== entry.path)
        && (local.savedAt || "") === (nextRecord.savedAt || "");
      if (recordIsNewer(nextRecord, local) || shouldMigratePath) {
        await saveRecord(nextRecord);
        imported += 1;
      }
    }

    if (statusEl) {
      statusEl.textContent = imported
        ? `已同步 ${imported} 个库存分析看板文件库记录。`
        : "库存分析看板文件库已检查，无需更新。";
    }
    return { ok: true, imported, manifest };
  } catch (error) {
    if (statusEl) statusEl.textContent = `库存分析看板文件库未加载：${error.message}`;
    return { ok: false, error };
  }
}

async function buildSharedLibraryPayload() {
  const all = await getAllRecords();
  const records = {};
  for (const record of all) {
    const displayRecord = getDisplayRecord(record);
    if (displayRecord) records[record.id] = displayRecord;
  }
  return {
    schemaVersion: 1,
    project: "kcfx",
    savedAt: new Date().toISOString(),
    records
  };
}

async function downloadSharedLibrary() {
  const payload = await buildSharedLibraryPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kcfx-file-library-package.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importSharedLibraryFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const statusEl = document.querySelector("#sharedStatus");
  try {
    const payload = JSON.parse(await file.text());
    const records = payload.records || {};
    let imported = 0;
    for (const [id, record] of Object.entries(records)) {
      if (!SLOT_BY_ID[id] || !Array.isArray(record.rows)) continue;
      await saveRecord({ ...record, id, importedAt: new Date().toISOString() });
      imported += 1;
    }
    if (statusEl) statusEl.textContent = `已导入 ${imported} 个文件库记录。`;
    if (typeof renderLibrary === "function") await renderLibrary();
  } catch (error) {
    if (statusEl) statusEl.textContent = `导入失败：${error.message}`;
  } finally {
    input.value = "";
  }
}
