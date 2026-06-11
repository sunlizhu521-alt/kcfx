const KC_DB_NAME = "kcfx-inventory-analysis-file-library";
const KC_LEGACY_DB_NAMES = ["kcfx-dashboard"];
const KC_DB_VERSION = 1;
const KC_STORE = "files";
const KC_XLSX_SCRIPT_URL = "vendor/xlsx.full.min.js?v=20260611b";
let kcfxMigrationPromise = null;
let kcfxXlsxLoadPromise = null;

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
    title: "客户与物料对照表",
    expectedName: "客户与物料对照表",
    sheetHint: "",
    description: "预留维度槽位。"
  },
  {
    id: "dim-customer-material",
    type: "dimension",
    title: "店铺名称汇总（金蝶&领星&简称）",
    expectedName: "店铺名称汇总（金蝶&领星&简称）",
    sheetHint: "Dim-店铺名称汇总（金蝶&领星&简称）",
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
    title: "库存分析月份表",
    expectedName: "库存分析月份表",
    sheetHint: "",
    description: "预留事实表槽位。"
  },
  {
    id: "fact-3",
    type: "fact",
    title: "收发汇总表1月",
    expectedName: "收发汇总表1月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  },
  {
    id: "fact-4",
    type: "fact",
    title: "收发汇总表2月",
    expectedName: "收发汇总表2月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  },
  {
    id: "fact-5",
    type: "fact",
    title: "收发汇总表3月",
    expectedName: "收发汇总表3月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  },
  {
    id: "fact-6",
    type: "fact",
    title: "收发汇总表4月",
    expectedName: "收发汇总表4月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  },
  {
    id: "fact-7",
    type: "fact",
    title: "收发汇总表5月",
    expectedName: "收发汇总表5月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  },
  {
    id: "fact-8",
    type: "fact",
    title: "收发汇总表6月",
    expectedName: "收发汇总表6月",
    sheetHint: "",
    skipRows: 3,
    description: "预留事实表槽位。"
  }
];

const SALES_SLOTS = [
  {
    id: "sales-data",
    type: "sales",
    title: "销售数据文件",
    expectedName: "销售数据文件",
    sheetHint: "",
    description: "用于上传销售数据文件，后续销售分析或库存联动分析可引用。"
  }
];

const ALL_SLOTS = [...FACT_SLOTS, ...DIMENSION_SLOTS, ...SALES_SLOTS];
const SLOT_BY_ID = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot]));

function openIndexedDbByName(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, KC_DB_VERSION);
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

async function openKcfxDb() {
  const db = await openIndexedDbByName(KC_DB_NAME);
  await migrateLegacyFileLibraries(db);
  return db;
}

async function migrateLegacyFileLibraries(targetDb) {
  if (!kcfxMigrationPromise) {
    kcfxMigrationPromise = migrateLegacyFileLibrariesOnce(targetDb).catch(() => {});
  }
  return kcfxMigrationPromise;
}

async function migrateLegacyFileLibrariesOnce(targetDb) {
  for (const legacyName of KC_LEGACY_DB_NAMES) {
    if (legacyName === KC_DB_NAME) continue;
    const legacyDb = await openIndexedDbByName(legacyName).catch(() => null);
    if (!legacyDb) continue;
    try {
      if (!legacyDb.objectStoreNames.contains(KC_STORE)) continue;
      const legacyRecords = await readAllFromDb(legacyDb);
      for (const legacyRecord of legacyRecords) {
        if (!legacyRecord?.id || !SLOT_BY_ID[legacyRecord.id]) continue;
        const localRecord = await readRecordFromDb(targetDb, legacyRecord.id);
        if (recordIsNewer(legacyRecord, localRecord)) {
          await writeRecordToDb(targetDb, {
            ...legacyRecord,
            migratedFromDb: legacyName,
            migratedAt: new Date().toISOString()
          });
        }
      }
    } finally {
      legacyDb.close();
    }
  }
}

function readAllFromDb(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KC_STORE, "readonly");
    const request = tx.objectStore(KC_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function readRecordFromDb(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KC_STORE, "readonly");
    const request = tx.objectStore(KC_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function writeRecordToDb(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KC_STORE, "readwrite");
    tx.objectStore(KC_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
  return records
    .map((record) => {
      const latest = getLatestUploadedRecord(record);
      if (!latest) return null;
      return {
        ...latest,
        appliedAt: latest.appliedAt || record?.appliedAt || latest.savedAt || ""
      };
    })
    .filter((record) => record?.appliedAt && !isDeletedRecord(record));
}

function getDisplayRecord(record) {
  if (!record || isDeletedRecord(record)) return null;
  return getLatestUploadedRecord(record);
}

function hasPendingRecord(record) {
  return !isDeletedRecord(record) && Boolean(record?.pending) && getLatestUploadedRecord(record) === record.pending;
}

function isDeletedRecord(record) {
  return Boolean(record?.deletedAt);
}

function promotePendingRecord(record) {
  if (isDeletedRecord(record)) return null;
  const source = getLatestUploadedRecord(record);
  if (!source) return null;
  const next = { ...source, appliedAt: new Date().toISOString() };
  delete next.pending;
  return next;
}

function getLatestUploadedRecord(record) {
  if (!record || isDeletedRecord(record)) return null;
  const current = { ...record };
  delete current.pending;
  const pending = record.pending && !isDeletedRecord(record.pending) ? record.pending : null;
  if (!pending) return current;
  return recordTime(pending) >= recordTime(current) ? pending : current;
}

function recordTime(record) {
  const candidates = [
    Date.parse(record?.savedAt || 0),
    Number(record?.lastModified || 0),
    Date.parse(record?.appliedAt || 0),
    Date.parse(record?.sharedSavedAt || 0)
  ].filter((time) => Number.isFinite(time) && time > 0);
  return candidates.length ? Math.max(...candidates) : 0;
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

function pickSheetName(workbook, slot = {}) {
  const sheetNames = workbook.SheetNames || [];
  const hint = normalizeHeaderName(slot.sheetHint || "");
  if (hint) {
    const matched = sheetNames.find((name) => normalizeHeaderName(name) === hint)
      || sheetNames.find((name) => normalizeHeaderName(name).includes(hint) || hint.includes(normalizeHeaderName(name)));
    if (matched) return matched;
  }
  return sheetNames[0];
}

function parseWorkbookRows(workbook, slot) {
  const xlsx = getXlsxLib();
  const sheetName = pickSheetName(workbook, slot);
  const sheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
    range: 0
  });
  const candidates = parseHeaderCandidates(matrix, slot);
  const selected = chooseHeaderCandidate(candidates, slot);
  return {
    sheetName,
    headerRowNumber: selected.headerRowNumber,
    parseNote: selected.parseNote,
    attemptedHeaderRows: candidates.map((candidate) => ({
      headerRowNumber: candidate.headerRowNumber,
      rowCount: candidate.rows.length,
      score: candidate.score,
      headerFirst6: candidate.headers.slice(0, 6)
    })),
    headers: selected.headers,
    rows: selected.rows
  };
}

function parseHeaderCandidates(matrix, slot = {}) {
  return headerRowCandidates(slot, matrix.length)
    .map((rowIndex) => parseRowsFromHeaderIndex(matrix, rowIndex, slot))
    .filter(Boolean);
}

function headerRowCandidates(slot = {}, matrixLength = 0) {
  const configured = Number.isInteger(slot.skipRows) ? slot.skipRows : 0;
  const maxIndex = Math.max(0, Math.min(matrixLength - 1, 9));
  const candidates = [configured, 0, 3];
  for (let index = 0; index <= maxIndex; index += 1) candidates.push(index);
  return [...new Set(candidates)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < Math.max(matrixLength, 1));
}

function parseRowsFromHeaderIndex(matrix, headerIndex, slot = {}) {
  const headerValues = matrix[headerIndex] || [];
  const headers = headerValues.map((value, index) => normalizeHeaderCell(value, index));
  const rows = matrix.slice(headerIndex + 1)
    .filter((values) => Array.isArray(values) && values.some((value) => normalizeText(value) !== ""))
    .map((values) => rowFromHeaderValues(headers, values));
  const score = scoreHeaderCandidate(headers, rows, headerIndex, slot);
  return {
    headerRowIndex: headerIndex,
    headerRowNumber: headerIndex + 1,
    parseNote: `${headerIndex + 1} 行作为表头`,
    headers,
    rows,
    score
  };
}

function chooseHeaderCandidate(candidates, slot = {}) {
  if (!candidates.length) {
    return {
      headerRowIndex: 0,
      headerRowNumber: 1,
      parseNote: "未找到可解析表头",
      headers: [],
      rows: [],
      score: 0
    };
  }
  return [...candidates].sort((a, b) => b.score - a.score || a.headerRowIndex - b.headerRowIndex)[0];
}

function scoreHeaderCandidate(headers, rows, headerIndex, slot = {}) {
  const normalizedHeaders = headers.map(normalizeHeaderName);
  const nonEmptyHeaders = normalizedHeaders.filter((header) => header && !header.startsWith("__empty_"));
  const headerText = normalizedHeaders.join("|");
  const keywordScore = headerKeywordsForSlot(slot)
    .reduce((score, keyword) => score + (headerText.includes(normalizeHeaderName(keyword)) ? 1 : 0), 0);
  const configured = Number.isInteger(slot.skipRows) ? slot.skipRows : 0;
  const configuredBonus = headerIndex === configured ? 6 : 0;
  const firstRowBonus = headerIndex === 0 ? 2 : 0;
  const rowsScore = Math.min(rows.length, 20) / 2;
  const emptyHeaderPenalty = Math.max(0, headers.length - nonEmptyHeaders.length) / 2;
  const numericHeaderPenalty = nonEmptyHeaders.filter((header) => /^-?\d+(\.\d+)?$/.test(header)).length * 3;
  return keywordScore * 20 + nonEmptyHeaders.length * 2 + rowsScore + configuredBonus + firstRowBonus - emptyHeaderPenalty - numericHeaderPenalty;
}

function headerKeywordsForSlot(slot = {}) {
  const common = ["物料", "编码", "数量", "库存", "仓库", "组织", "结存", "结余"];
  if (slot.id === "fact-inventory") {
    return [...common, "结存数量", "真实成本", "真实成本单价", "货品"];
  }
  if (slot.id === "fact-2") {
    return [...common, "0430", "结余库存数量", "结算价", "库龄", "销售产品线", "销售系列"];
  }
  if (/^fact-[3-8]$/.test(slot.id || "")) {
    return [...common, "结算价", "含税", "库存数量", "期末", "收发"];
  }
  return common;
}

function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) {
    return row.__cells[index] ?? "";
  }
  return Object.entries(row || {})
    .filter(([key]) => key !== "__cells")
    .map(([, value]) => value)[index] ?? "";
}

function normalizeHeaderCell(value, index) {
  const text = normalizeText(value);
  return text || `__EMPTY_${index + 1}`;
}

function rowFromHeaderValues(headers, values, rawValues = []) {
  const normalizedValues = values.map((value, index) => normalizeCellValue(value, rawValues[index]));
  const row = { __cells: normalizedValues };
  headers.forEach((header, index) => {
    row[header] = normalizedValues[index];
  });
  return row;
}

function normalizeCellValue(value, rawValue = value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "string" && value.startsWith("#")) return "";
  if (typeof rawValue === "number" && Number.isFinite(rawValue) && !Number.isInteger(rawValue)) return rawValue;
  return value;
}

function buildParseDiagnostics(parsed) {
  const rows = parsed.rows || [];
  const headers = parsed.headers || Object.keys(rows[0] || {});
  return {
    sheetName: parsed.sheetName || "",
    headerRowNumber: parsed.headerRowNumber || 1,
    parseNote: parsed.parseNote || "",
    attemptedHeaderRows: parsed.attemptedHeaderRows || [],
    headerFirst12: headers.slice(0, 12),
    gHeader: headers[6] || "",
    hHeader: headers[7] || "",
    adHeader: headers[29] || "",
    gSamples: rows.slice(0, 3).map((row) => nthValue(row, 7)),
    hSamples: rows.slice(0, 3).map((row) => nthValue(row, 8)),
    adSamples: rows.slice(0, 3).map((row) => nthValue(row, 30))
  };
}

async function readExcelFile(file, slot) {
  const xlsx = await ensureXlsxLoaded();
  const attempts = [];
  try {
    const buffer = await readFileBuffer(file);
    return buildFileRecord(file, slot, parseWorkbookInput(xlsx, buffer, "array", slot), "array", attempts);
  } catch (error) {
    attempts.push(`array：${error?.message || error}`);
    try {
      const base64 = await readFileBase64(file);
      return buildFileRecord(file, slot, parseWorkbookInput(xlsx, base64, "base64", slot), "base64", attempts);
    } catch (fallbackError) {
      attempts.push(`base64：${fallbackError?.message || fallbackError}`);
      throw normalizeExcelParseError(fallbackError, file, attempts);
    }
  }
}

function parseWorkbookInput(xlsx, data, type, slot) {
  const workbook = xlsx.read(data, {
    type,
    cellDates: true,
    dense: true,
    cellHTML: false,
    cellNF: false,
    cellStyles: false
  });
  return parseWorkbookRows(workbook, slot);
}

function buildFileRecord(file, slot, parsed, readMode, attempts = []) {
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
    parseDiagnostics: {
      ...buildParseDiagnostics(parsed),
      readMode,
      fallbackAttempts: attempts
    },
    rows: parsed.rows
  };
}

async function readFileBuffer(file) {
  if (file?.arrayBuffer) return await file.arrayBuffer();
  return await readFileBufferWithFileReader(file);
}

function readFileBufferWithFileReader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败。"));
    reader.readAsArrayBuffer(file);
  });
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

function normalizeExcelParseError(error, file, attempts = []) {
  const message = error?.message || String(error || "未知错误");
  const fileSize = formatFileSizeForError(file?.size || 0);
  const attemptsText = attempts.length ? `；尝试路径：${attempts.join("；")}` : "";
  if (/Array buffer allocation failed|allocation failed|out of memory|memory/i.test(message)) {
    const smallFile = Number(file?.size || 0) > 0 && Number(file?.size || 0) < 5 * 1024 * 1024;
    if (smallFile) {
      return new Error(`浏览器解析这个小文件${fileSize ? `（${fileSize}）` : ""}时触发内存分配异常，通常是工作簿格式或声明的使用区域异常，不是文件大小本身。请用 Excel 打开后另存为标准 .xlsx，删除隐藏空白行列/无用工作表后再上传。原始错误：${message}${attemptsText}`);
    }
    return new Error(`浏览器内存不足，无法一次性读取这个文件${fileSize ? `（${fileSize}）` : ""}。建议先在 Excel 中另存为 .xlsx、删除无用工作表/空白区域，或拆分后再上传。原始错误：${message}${attemptsText}`);
  }
  if (attempts.length) {
    return new Error(`${message}${attemptsText}`);
  }
  return error instanceof Error ? error : new Error(message);
}

function formatFileSizeForError(bytes) {
  const numeric = Number(bytes) || 0;
  if (!numeric) return "";
  if (numeric >= 1024 * 1024) return `${(numeric / 1024 / 1024).toFixed(1)} MB`;
  if (numeric >= 1024) return `${(numeric / 1024).toFixed(1)} KB`;
  return `${numeric} B`;
}

function getXlsxLib() {
  return globalThis.XLSX || null;
}

async function ensureXlsxLoaded() {
  const loaded = getXlsxLib();
  if (loaded?.read && loaded?.utils?.sheet_to_json) return loaded;
  if (!kcfxXlsxLoadPromise) {
    kcfxXlsxLoadPromise = loadXlsxScript();
  }
  await kcfxXlsxLoadPromise;
  const reloaded = getXlsxLib();
  if (reloaded?.read && reloaded?.utils?.sheet_to_json) return reloaded;
  throw new Error("Excel 解析组件未加载成功，请清除当前页面缓存后刷新重试。");
}

function loadXlsxScript() {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("当前浏览器环境不支持加载 Excel 解析组件。"));
      return;
    }
    const script = document.createElement("script");
    script.src = `${KC_XLSX_SCRIPT_URL}&retry=${Date.now()}`;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Excel 解析组件加载失败，请检查网络后刷新页面。"));
    document.head.appendChild(script);
  });
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
