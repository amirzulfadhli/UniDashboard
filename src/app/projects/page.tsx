import { WorkScreen } from "../work-screen";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { return <WorkScreen search={await searchParams} projectsOnly />; }
