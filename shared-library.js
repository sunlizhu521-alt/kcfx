const KC_FILE_LIBRARY_MANIFEST = "data/kcfx-library/manifest.json";
let kcSharedLibraryLoadPromise = null;

async function loadSharedLibrary(options = {}) {
  const statusEl = options.statusEl || null;
  if (options.force) kcSharedLibraryLoadPromise = null;
  if (!kcSharedLibraryLoadPromise) kcSharedLibraryLoadPromise = loadKcfxFileLibrary(null);
  const result = await kcSharedLibraryLoadPromise;
  if (statusEl) renderSharedLibraryStatus(statusEl, result);
  return result;
}

function renderSharedLibraryStatus(statusEl, result) {
  if (!result?.ok) {
    statusEl.textContent = `文件库未加载：${result?.error?.message || "未知错误"}`;
    return;
  }
  const entries = Object.entries(result.manifest?.records || {});
  statusEl.textContent = buildSharedLibraryStatus(result.imported, result.cleared, entries.length);
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
      if (shouldImportSharedRecord(nextRecord, local)) {
        await saveRecord(nextRecord);
        imported += 1;
      }
    }

    const cleared = await clearStaleSharedRecords(new Set(entries.map(([id]) => id)));
    if (statusEl) statusEl.textContent = buildSharedLibraryStatus(imported, cleared, entries.length);
    return { ok: true, imported, cleared, manifest };
  } catch (error) {
    if (statusEl) statusEl.textContent = `文件库未加载：${error.message}`;
    return { ok: false, error };
  }
}

function shouldImportSharedRecord(shared, local) {
  if (!local) return true;
  if (isDeletedRecord(local) || hasPendingRecord(local)) return false;
  if (isLocalBrowserRecord(local)) return false;
  if (recordIsNewer(shared, local)) return true;
  return sharedIsNotOlder(shared, local) && libraryRecordDiffers(shared, local);
}

function isLocalBrowserRecord(record) {
  return Boolean(record)
    && !record.libraryPath
    && !record.libraryManifestPath
    && !record.sharedSavedAt;
}

function isSharedLibraryRecord(record) {
  return Boolean(record?.libraryPath || record?.libraryManifestPath || record?.sharedSavedAt);
}

async function clearStaleSharedRecords(activeSharedIds) {
  const records = await getAllRecords();
  let cleared = 0;
  for (const record of records) {
    if (!record?.id || !SLOT_BY_ID[record.id]) continue;
    if (activeSharedIds.has(record.id)) continue;
    if (isDeletedRecord(record) || hasPendingRecord(record) || isLocalBrowserRecord(record)) continue;
    if (!isSharedLibraryRecord(record)) continue;
    const deletedAt = new Date().toISOString();
    await saveRecord({
      id: record.id,
      type: record.type || SLOT_BY_ID[record.id]?.type || "",
      title: record.title || SLOT_BY_ID[record.id]?.title || record.id,
      expectedName: record.expectedName || SLOT_BY_ID[record.id]?.expectedName || "",
      fileName: "",
      savedAt: deletedAt,
      deletedAt,
      clearedSharedDefault: true
    });
    cleared += 1;
  }
  return cleared;
}

function buildSharedLibraryStatus(imported, cleared, sharedCount) {
  if (!sharedCount && cleared) return `文件库共享默认数据已清空，已清理 ${cleared} 个旧共享记录。`;
  if (!sharedCount) return "文件库共享默认数据为空，请上传并应用最新文件。";
  if (imported && cleared) return `已同步 ${imported} 个文件库记录，并清理 ${cleared} 个旧共享记录。`;
  if (imported) return `已同步 ${imported} 个文件库记录。`;
  if (cleared) return `已清理 ${cleared} 个旧共享记录。`;
  return "文件库已检查，无需更新。";
}

function sharedIsNotOlder(shared, local) {
  const sharedTime = Date.parse(shared.savedAt || shared.appliedAt || shared.sharedSavedAt || 0);
  const localTime = Math.max(
    Date.parse(local.savedAt || 0) || 0,
    Date.parse(local.appliedAt || 0) || 0,
    Date.parse(local.sharedSavedAt || 0) || 0
  );
  if (!Number.isFinite(sharedTime) || !Number.isFinite(localTime)) return false;
  return sharedTime >= localTime;
}

function libraryRecordDiffers(shared, local) {
  if (!local) return true;
  if (hasPendingRecord(local)) return false;
  return isDeletedRecord(local)
    || (local.libraryPath || "") !== (shared.libraryPath || "")
    || (local.savedAt || "") !== (shared.savedAt || "")
    || (local.appliedAt || "") !== (shared.appliedAt || "")
    || (local.sharedSavedAt || "") !== (shared.sharedSavedAt || "")
    || (local.size || 0) !== (shared.size || 0);
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
