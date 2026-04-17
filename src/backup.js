import fs from "node:fs";
import path from "node:path";
import { dbPath } from "./db.js";

const backupDir = path.resolve("backups");
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-");
const target = path.join(backupDir, `store-${timestamp}.db`);
fs.copyFileSync(dbPath, target);

console.log(`Backup written to ${target}`);
