import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db, dbPath } from "./db.js";

const backupDir = path.resolve("backups");
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-");
const target = path.join(backupDir, `store-${timestamp}.db`);

db.exec("PRAGMA wal_checkpoint(FULL);");
execFileSync("sqlite3", [dbPath, `.backup ${target}`], { stdio: "ignore" });
fs.chmodSync(target, 0o600);

console.log(`Backup written to ${target}`);
