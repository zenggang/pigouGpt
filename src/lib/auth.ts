import "server-only";

import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";
import { execute, firstRow, queryRows } from "./db";

export type AuthUser = {
  id: number;
  email: string;
  name: string | null;
  role: "user" | "admin";
};

type UserRow = RowDataPacket & {
  id: number;
  email: string;
  name: string | null;
  role: "user" | "admin";
  password_hash: string | null;
  is_enabled: 0 | 1;
};

type SessionUserRow = RowDataPacket & AuthUser & {
  expires_at: Date;
};

const SESSION_COOKIE = "pigou_session";
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS ?? "7");

export async function loginWithPassword(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  if (!email || !password) {
    return null;
  }

  const user = firstRow(
    await queryRows<UserRow[]>(
      `select id, email, name, role, password_hash, is_enabled
       from users
       where email = ?
       limit 1`,
      [email],
    ),
  );

  if (!user || user.is_enabled !== 1 || !user.password_hash) {
    console.warn("auth login rejected", { email, reason: "user_missing_or_disabled" });
    return null;
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    console.warn("auth login rejected", { email, reason: "bad_password" });
    return null;
  }

  await createSession(user.id);
  await execute("update users set last_login_at = current_timestamp(3) where id = ?", [user.id]);

  console.info("auth login succeeded", { userId: user.id, email: user.email });
  return toAuthUser(user);
}

export async function changePasswordWithOldPassword(
  emailInput: string,
  oldPassword: string,
  newPassword: string,
) {
  const email = normalizeEmail(emailInput);
  if (!email || !oldPassword || !isValidPassword(newPassword)) {
    return false;
  }

  const user = firstRow(
    await queryRows<UserRow[]>(
      `select id, email, name, role, password_hash, is_enabled
       from users
       where email = ?
       limit 1`,
      [email],
    ),
  );

  if (!user || user.is_enabled !== 1 || !user.password_hash) {
    console.warn("auth password change rejected", { email, reason: "user_missing_or_disabled" });
    return false;
  }

  const passwordOk = await bcrypt.compare(oldPassword, user.password_hash);
  if (!passwordOk) {
    console.warn("auth password change rejected", { userId: user.id, reason: "bad_old_password" });
    return false;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // 密码变更后清理该账号已有会话，避免旧设备继续使用已变更密码前的登录态。
  await execute("update users set password_hash = ? where id = ?", [passwordHash, user.id]);
  await execute("delete from user_sessions where user_id = ?", [user.id]);

  console.info("auth password changed", { userId: user.id, email: user.email });
  return true;
}

export async function logout() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await execute("delete from user_sessions where token_hash = ?", [hashToken(token)]);
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const session = firstRow(
    await queryRows<SessionUserRow[]>(
      `select u.id, u.email, u.name, u.role, s.expires_at
       from user_sessions s
       join users u on u.id = s.user_id
       where s.token_hash = ?
         and s.expires_at > current_timestamp(3)
         and u.is_enabled = 1
       limit 1`,
      [hashToken(token)],
    ),
  );

  return session ? toAuthUser(session) : null;
}

export async function requireCurrentUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthRequiredError();
  }
  return user;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("请先登录后再使用 Pigou AI Console。");
    this.name = "AuthRequiredError";
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidPassword(password: string) {
  return password.length >= 6 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  // 登录时清理同一用户过期会话，避免长期运行后 session 表无界增长。
  await execute("delete from user_sessions where user_id = ? and expires_at <= current_timestamp(3)", [
    userId,
  ]);
  await execute(
    `insert into user_sessions (user_id, token_hash, expires_at)
     values (?, ?, ?)`,
    [userId, tokenHash, expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toAuthUser(user: Pick<UserRow, "id" | "email" | "name" | "role">): AuthUser {
  return {
    id: Number(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
