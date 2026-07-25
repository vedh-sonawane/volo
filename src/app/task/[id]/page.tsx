import { Workspace } from "@/components/workspace/Workspace";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace taskId={id} />;
}
