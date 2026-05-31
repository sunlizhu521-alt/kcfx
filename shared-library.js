async function loadSharedLibrary(options = {}) {
  const statusEl = options.statusEl || null;
  const cacheKey = `v=${Date.now()}`;
  try {
    const response = await fetch(`data/shared-library.json?${cacheKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const records = payload.records || {};
    let imported = 0;

    for (const [id, record] of Object.entries(records)) {
      if (!SLOT_BY_ID[id] || !Array.isArray(record.rows)) continue;
      const local = await getRecord(id);
      if (recordIsNewer(record, local)) {
        await saveRecord({ ...record, id });
        imported += 1;
      }
    }

    if (statusEl) {
      statusEl.textContent = imported
        ? `已同步 ${imported} 个共享文件。`
        : "共享文件库已检查，无需更新。";
    }
    return { ok: true, imported, payload };
  } catch (error) {
    if (statusEl) statusEl.textContent = `共享文件库未加载：${error.message}`;
    return { ok: false, error };
  }
}

async function buildSharedLibraryPayload() {
  const all = await getAllRecords();
  const records = {};
  for (const record of all) {
    records[record.id] = record;
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
  link.download = "shared-library.json";
  link.click();
  URL.revokeObjectURL(url);
}

