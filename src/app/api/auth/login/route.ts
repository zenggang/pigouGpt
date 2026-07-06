import { loginWithPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const { email, password } = payload as Partial<{ email: string; password: string }>;
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json({ message: "请输入邮箱和密码。" }, { status: 400 });
  }

  try {
    const user = await loginWithPassword(email, password);
    if (!user) {
      return Response.json({ message: "账号不存在、未启用或密码不正确。" }, { status: 401 });
    }

    return Response.json({ user });
  } catch (error) {
    console.error("auth login failed", {
      email: email.trim().toLowerCase(),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { message: error instanceof Error ? error.message : "登录服务暂时不可用。" },
      { status: 500 },
    );
  }
}
