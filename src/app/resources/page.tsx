import { KnowledgeScreen } from "../knowledge-screen";
export default async function ResourcesPage({ searchParams }: { searchParams: Promise<{ view?: string; course?: string; id?: string; error?: string }> }) { return <KnowledgeScreen kind="RESOURCE" search={await searchParams} />; }
