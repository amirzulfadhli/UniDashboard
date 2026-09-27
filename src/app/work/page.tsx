import { WorkScreen } from "../work-screen";
export default async function WorkPage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string; course?: string; project?: string; date?: string; startDate?: string; endDate?: string; error?: string }> }) { return <WorkScreen search={await searchParams} />; }
