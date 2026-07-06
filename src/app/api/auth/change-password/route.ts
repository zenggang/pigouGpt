import { changePasswordWithOldPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const { email, oldPassword, newPassword, confirmPassword } = payload as Partial<{
    email: string;
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>;

  if (
    typeof email !== "string" ||
    typeof oldPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return Response.json({ message: "请输入邮箱、旧密码和新密码。" }, { status: 400 });
  }

  if (newPassword !== confirmPassword) {
    return Response.json({ message: "两次输入的新密码不一致。" }, { status: 400 });
  }

  if (!isValidPassword(newPassword)) {
    return Response.json(
      { message: "新密码至少 6 位，并且需要同时包含字母和数字。" },
      { status: 400 },
    );
  }

  try {
    const changed = await changePasswordWithOldPassword(email, oldPassword, newPassword);
    if (!changed) {
      return Response.json({ message: "账号不存在、未启用或旧密码不正确。" }, { status: 401 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("auth password change failed", {
      email: email.trim().toLowerCase(),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { message: error instanceof Error ? error.message : "密码修改服务暂时不可用。" },
      { status: 500 },
    );
  }
}

function isValidPassword(password: string) {
  return password.length >= 6 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
