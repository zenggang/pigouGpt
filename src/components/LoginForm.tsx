"use client";

import { ArrowLeft, KeyRound, LockKeyhole, Loader2, LogIn } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "./BrandMark";

export function LoginForm({ setupError }: { setupError?: string | null }) {
  const [mode, setMode] = useState<"login" | "changePassword">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(setupError ?? null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupError || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.message || "登录失败，请检查账号和密码。");
      }

      window.location.href = "/";
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupError || isSubmitting) {
      return;
    }

    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    if (!isValidPassword(newPassword)) {
      setError("新密码至少 6 位，并且需要同时包含字母和数字。");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, oldPassword, newPassword, confirmPassword }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.message || "密码修改失败，请检查旧密码。");
      }

      setPassword("");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMode("login");
      setSuccess("密码已修改，请使用新密码登录。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "密码修改失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode(nextMode: "login" | "changePassword") {
    setMode(nextMode);
    setError(setupError ?? null);
    setSuccess(null);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f7f5] px-4 py-8 text-zinc-950">
      <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <h1 className="text-base font-semibold">Pigou AI Console</h1>
            <p className="text-xs text-zinc-500">仅限已配置账号登录</p>
          </div>
        </div>

        {mode === "login" ? (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              disabled={isSubmitting || !!setupError}
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
            />
          </label>

          <label className="block text-sm font-medium text-zinc-700">
            密码
            <div className="relative mt-2">
              <LockKeyhole
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={isSubmitting || !!setupError}
                className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
              />
            </div>
          </label>

          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-5 text-emerald-700">
              {success}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !!setupError || !email.trim() || !password}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
            登录
          </button>

          <button
            type="button"
            onClick={() => switchMode("changePassword")}
            disabled={isSubmitting || !!setupError}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyRound size={14} />
            修改密码
          </button>
        </form>
        ) : (
          <form onSubmit={submitPasswordChange} className="space-y-4">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 transition hover:text-zinc-950"
            >
              <ArrowLeft size={14} />
              返回登录
            </button>

            <label className="block text-sm font-medium text-zinc-700">
              邮箱
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={isSubmitting || !!setupError}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
              />
            </label>

            <label className="block text-sm font-medium text-zinc-700">
              旧密码
              <div className="relative mt-2">
                <LockKeyhole
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting || !!setupError}
                  className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
                />
              </div>
            </label>

            <label className="block text-sm font-medium text-zinc-700">
              新密码
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || !!setupError}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
              />
            </label>

            <label className="block text-sm font-medium text-zinc-700">
              确认新密码
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || !!setupError}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 disabled:bg-zinc-50"
              />
            </label>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">
              新密码至少 6 位，并且需要同时包含字母和数字。
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                isSubmitting ||
                !!setupError ||
                !email.trim() ||
                !oldPassword ||
                !newPassword ||
                !confirmPassword
              }
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              确认修改
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function isValidPassword(password: string) {
  return password.length >= 6 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
