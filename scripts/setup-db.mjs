import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { loadEnvConfig } from "@next/env";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(projectDir);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("请先配置 DATABASE_URL，例如 mysql://user:password@127.0.0.1:3306/your_app_database");
}

const parsedUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
if (!databaseName) {
  throw new Error("DATABASE_URL 必须包含数据库名，例如 /your_app_database");
}

const adminUrl = new URL(parsedUrl);
adminUrl.pathname = "/";
adminUrl.search = "";

const adminConnection = await mysql.createConnection({ uri: adminUrl.toString() });
await adminConnection.query(
  `create database if not exists \`${databaseName.replaceAll("`", "``")}\`
   default character set utf8mb4 collate utf8mb4_unicode_ci`,
);
await adminConnection.end();

const schema = await readFile(path.join(projectDir, "database", "schema.sql"), "utf8");
const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: true,
});
await connection.query(schema);

const emails = (process.env.INITIAL_USER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const password = process.env.INITIAL_USER_PASSWORD;

if (emails.length === 0) {
  await connection.end();
  throw new Error("请配置 INITIAL_USER_EMAILS，用逗号分隔需要初始化的登录账号。");
}

if (!password) {
  await connection.end();
  throw new Error("请配置 INITIAL_USER_PASSWORD，用于初始化登录账号密码。");
}

const passwordHash = await bcrypt.hash(password, 12);

for (const email of emails) {
  const name = email.split("@")[0] || email;
  await connection.execute(
    `insert into users (email, name, role, password_hash, is_enabled)
     values (?, ?, 'user', ?, 1)
     on duplicate key update
       name = values(name),
       password_hash = values(password_hash),
       is_enabled = 1,
       updated_at = current_timestamp(3)`,
    [email, name, passwordHash],
  );
}

await connection.end();

console.log(`MySQL 数据库已初始化：${databaseName}`);
console.log(`已启用账号：${emails.join(", ")}`);
