import { ConsoleApp } from "@/components/ConsoleApp";
import { getCurrentUser } from "@/lib/auth";
import { getLatestConversationSnapshot, listConversations } from "@/lib/conversations";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const snapshot = await getLatestConversationSnapshot(user.id);
  const conversations = await listConversations(user.id);

  return (
    <ConsoleApp
      user={{ email: user.email, name: user.name }}
      initialConversationId={snapshot.conversationId}
      initialMessages={snapshot.messages}
      initialConversations={conversations}
    />
  );
}
