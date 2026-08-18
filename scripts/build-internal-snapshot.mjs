import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseInternalWorkbook } from "../src/lib/internal-snapshot-parser.mjs";

const source = process.argv[2] ?? "/Users/andriiliudvichuk/Downloads/закупівлі.xlsx";
// Підтверджено: цей файл — реєстр капітального будівництва. Файли сервісу та
// кондиціонування ще не підключені, тому їх напрямки залишаються без реєстру.
const registryDirection = process.argv[3] ?? "Капбудівництво";
const target = path.join(process.cwd(), "src/data/internal-snapshot.json");
const file = await stat(source);
// Дата в snapshot має означати «коли файл змінили в SharePoint», а не «коли ми
// його скопіювали». Якщо копію тягнули вручну, точний час передається окремо.
const exportedAt = process.env.INTERNAL_EXPORTED_AT ?? file.mtime.toISOString();
const snapshot = await parseInternalWorkbook(await readFile(source), {
  exportedAt,
  source: process.env.INTERNAL_SOURCE_LABEL ?? "SharePoint · закупівлі.xlsx (read-only snapshot)",
  registryDirection,
});

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Built ${target}: ${snapshot.tenders.length} tenders · exportedAt ${exportedAt}`);
