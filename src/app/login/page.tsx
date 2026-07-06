import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let setupError: string | null = null;
  let hasUser = false;

  try {
    const user = await getCurrentUser();
    if (user) {
      hasUser = true;
    }
  } catch (error) {
    setupError = error instanceof Error ? error.message : "登录服务初始化失败。";
  }

  if (hasUser) {
    redirect("/");
  }

  return <LoginForm setupError={setupError} />;
}
