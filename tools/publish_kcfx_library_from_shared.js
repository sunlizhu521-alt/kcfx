const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "shared-library.json");
const libraryRoot = path.join(root, "data", "kcfx-library");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function main() {
  const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const manifest = {
    schemaVersion: 2,
    project: "kcfx",
    name: "库存分析看板文件库",
    savedAt: new Date().toISOString(),
    records: {}
  };

  for (const [id, record] of Object.entries(payload.records || {})) {
    const type = record.type || (id.startsWith("fact-") ? "fact" : "dimension");
    const folder = type === "fact" ? "fact" : "dimensions";
    const relativePath = `data/kcfx-library/${folder}/${id}.json`;
    const nextRecord = { ...record, id, libraryPath: relativePath };
    writeJson(path.join(root, relativePath), nextRecord);
    manifest.records[id] = {
      id,
      type,
      title: record.title || id,
      fileName: record.fileName || "",
      path: relativePath,
      rows: Array.isArray(record.rows) ? record.rows.length : 0,
      size: record.size || 0,
      savedAt: record.savedAt || "",
      appliedAt: record.appliedAt || record.savedAt || ""
    };
  }

  writeJson(path.join(libraryRoot, "manifest.json"), manifest);
  console.log(`Published ${Object.keys(manifest.records).length} records to data/kcfx-library`);
}

main();
