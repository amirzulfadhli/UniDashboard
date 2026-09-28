import { KnowledgeScreen } from "../knowledge-screen";
export default async function NotesPage({ searchParams }: { searchParams: Promise<{ view?: string; course?: string; id?: string; error?: string }> }) { return <KnowledgeScreen kind="NOTE" search={await searchParams} />; }
