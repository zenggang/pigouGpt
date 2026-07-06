import { logout } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await logout();
  return Response.json({ ok: true });
}
