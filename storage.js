const KC_DB_NAME = "kcfx-dashboard";
const KC_DB_VERSION = 1;
const KC_STORE = "files";

const DIMENSION_SLOTS = [
  {
    id: "dim-product",
    type: "dimension",
    title: "商品分类维表",
    expectedName: "Dim-YL医疗器械商品分类-2026年整理版",
    sheetHint: "Dim-YL医疗器械商品分类",
    description: "按物料编码匹配 SKU、金蝶名称、销售产品线、销售系列、采购分组、结算价（含税）。"
  },
  {
    id: "dim-warehouse",
    type: "dimension",
    title: "仓库、金蝶、旺店通、领星",
    expectedName: "Dim-仓库_金蝶、旺店通、领星-2026年整理版",
    sheetHint: "Dim-仓库汇总整理",
    description: "按仓库金蝶名称匹配一级仓库分类和二级仓库分类，区分仓库属性和仓库位置。"
  },
  {
    id: "dim-warehouse-material",
    type: "dimension",
    title: "仓库物料事业部对照表",
    expectedName: "Dim-仓库与物料对照表-2026年整理版",
    sheetHint: "",
    description: "使用库存组织、仓库名称、物料编码三元联合键匹配事业部。"
  },
  {
    id: "dim-store-name",
    type: "dimension",
    title: "维度 4",
    expectedName: "维度 4",
    sheetHint: "",
    description: "预留维度槽位。"
  },
  {
    id: "dim-customer-material",
    type: "dimension",
    title: "维度 5",
    expectedName: "维度 5",
    sheetHint: "",
    description: "预留维度槽位。"
  },
  {
    id: "dim-purchase-division",
    type: "dimension",
    title: "维度 6",
    expectedName: "维度 6",
    sheetHint: "",
    description: "预留维度槽位。"
  },
  {
    id: "dim-7",
    type: "dimension",
    title: "维度 7",
    expectedName: "维度 7",
    sheetHint: "",
    description: "预留维度槽位。"
  },
  {
    id: "dim-8",
    type: "dimension",
    title: "维度 8",
    expectedName: "维度 8",
    sheetHint: "",
    description: "预留维度槽位。"
  }
];

const FACT_SLOTS = [
  {
    id: "fact-inventory",
    type: "fact",
    title: "关账后库存事实表",
    expectedName: "财务同步的表",
    sheetHint: "",
    skipRows: 0,
    description: "数据由财务提供，保持数量的一致性，财务提供的表只取数量和真实成本单价。"
  },
  {
    id: "fact-2",
    type: "fact",
    title: "事实表 2",
    expectedName: "事实表 2",
    sheetHint: "",
    description: "预留事实表槽位。"
  },
  {
    id: "fact-3",
    type: "fact",
    title: "事实表 3",
    expectedName: "事实表 3",
    sheetHint: "",
    description: "预留事实表槽位。"
  },
  {
    id: "fact-4",
    type: "fact",
    title: "事实表 4",
    expectedName: "事实表 4",
    sheetHint: "",
    description: "预留事实表槽位。"
  }
];

const ALL_SLOTS = [...FACT_SLOTS, ...DIMENSION_SLOTS];
const SLOT_BY_ID = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot]));

function openKcfxDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KC_DB_NAME, KC_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KC_STORE)) {
        db.createObjectStore(KC_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openKcfxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KC_STORE, mode);
    const store = tx.objectStore(KC_STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function getRecord(id) {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

function getAllRecords() {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
}

async function getActiveRecords() {
  const records = await getAllRecords();
  return records.filter((record) => record.appliedAt && !isDeletedRecord(record));
}

function getDisplayRecord(record) {
  if (!record || isDeletedRecord(record)) return null;
  return record.pending || record;
}

function hasPendingRecord(record) {
  return !isDeletedRecord(record) && Boolean(record?.pending);
}

function isDeletedRecord(record) {
  return Boolean(record?.deletedAt);
}

function promotePendingRecord(record) {
  if (isDeletedRecord(record)) return null;
  const source = record?.pending || record;
  if (!source) return null;
  const next = { ...source, appliedAt: new Date().toISOString() };
  delete next.pending;
  return next;
}

function saveRecord(record) {
  return withStore("readwrite", (store) => {
    store.put(record);
  });
}

async function deleteRecord(id) {
  const current = await getRecord(id);
  const slot = SLOT_BY_ID[id] || {};
  const deletedAt = new Date().toISOString();
  return withStore("readwrite", (store) => {
    store.put({
      id,
      type: current?.type || slot.type || "",
      title: current?.title || slot.title || id,
      expectedName: current?.expectedName || slot.expectedName || "",
      fileName: "",
      savedAt: deletedAt,
      deletedAt
    });
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function normalizeHeaderName(value) {
  return normalizeText(value)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, "");
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeText(value).replace(/[,\s￥¥元]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && normalizeText(row[name]) !== "") {
      return row[name];
    }
  }
  const wanted = names.map(normalizeHeaderName);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normalizeHeaderName(key)) && normalizeText(value) !== "") {
      return value;
    }
  }
  return "";
}

function firstValueByHeaderIncludes(row, includeWords, excludeWords = []) {
  const includes = includeWords.map(normalizeHeaderName).filter(Boolean);
  const excludes = excludeWords.map(normalizeHeaderName).filter(Boolean);
  for (const [key, value] of Object.entries(row)) {
    const header = normalizeHeaderName(key);
    const hasAllWords = includes.every((word) => header.includes(word));
    const hasExcludedWord = excludes.some((word) => header.includes(word));
    if (hasAllWords && !hasExcludedWord && normalizeText(value) !== "") {
      return value;
    }
  }
  return "";
}

function makeJoinKey(row) {
  return [
    normalizeText(firstValue(row, ["库存组织"])),
    normalizeText(firstValue(row, ["仓库名称", "金蝶名称", "仓库"])),
    normalizeMaterialCode(firstValue(row, ["物料编码"]))
  ].join("");
}

function pickSheetName(workbook, hint) {
  if (hint) {
    const found = workbook.SheetNames.find((name) => name.includes(hint));
    if (found) return found;
  }
  return workbook.SheetNames[0];
}

function parseWorkbookRows(workbook, slot) {
  const sheetName = pickSheetName(workbook, slot.sheetHint);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    range: slot.skipRows || 0
  });
  return {
    sheetName,
    rows: rows.map((row) => {
      const cleaned = {};
      Object.entries(row).forEach(([key, value]) => {
        cleaned[normalizeText(key)] = value;
      });
      return cleaned;
    })
  };
}

async function readExcelFile(file, slot) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const parsed = parseWorkbookRows(workbook, slot);
  return {
    id: slot.id,
    type: slot.type,
    title: slot.title,
    expectedName: slot.expectedName,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    savedAt: new Date().toISOString(),
    sheetName: parsed.sheetName,
    rows: parsed.rows
  };
}

function recordIsNewer(shared, local) {
  if (!local) return true;
  if (isDeletedRecord(local)) return false;
  const sharedTime = Date.parse(shared.savedAt || 0);
  const localSavedTime = Date.parse(local.savedAt || 0);
  const pendingSavedTime = Date.parse(local.pending?.savedAt || 0);
  const localTimes = [localSavedTime, pendingSavedTime].filter((time) => Number.isFinite(time));
  const localTime = localTimes.length ? Math.max(...localTimes) : NaN;
  if (Number.isFinite(sharedTime) && Number.isFinite(localTime) && sharedTime <= localTime) return false;
  if ((shared.size || 0) !== (local.size || 0)) return true;
  return Number.isFinite(sharedTime) && (!Number.isFinite(localTime) || sharedTime > localTime);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}
