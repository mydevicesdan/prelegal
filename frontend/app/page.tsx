import { NdaCreator } from "@/components/NdaCreator";
import { loadMutualNdaTemplates } from "@/lib/templates";

export default async function Home() {
  const templates = await loadMutualNdaTemplates();

  return (
    <main className="flex-1">
      <NdaCreator templates={templates} />
    </main>
  );
}
