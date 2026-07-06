import { AuthRequiredError, requireCurrentUser } from "@/lib/auth";
import { getImageJob } from "@/lib/image-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId")?.trim();

    if (!jobId) {
      return Response.json({ message: "缺少 jobId。" }, { status: 400 });
    }

    const job = await getImageJob(jobId);
    if (job.userId !== user.id) {
      return Response.json({ message: "图片任务不存在或无权访问。" }, { status: 404 });
    }

    return Response.json(job);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("image job load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { message: error instanceof Error ? error.message : "图片任务查询失败。" },
      { status: 500 },
    );
  }
}
