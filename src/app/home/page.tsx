import { redirect } from "next/navigation";
import { getPrisma } from "../../auth/db";
import { getDashboard } from "../../dashboard/queries";
import { DashboardScreen } from "./dashboard-screen";
import { requirePageUser } from "../protected-user";
import "./dashboard.css";

export default async function HomePage() {
  const owner = await requirePageUser();
  const dashboard = await getDashboard(getPrisma(), owner);
  if (!dashboard.ready) redirect(dashboard.destination);
  return <DashboardScreen dashboard={dashboard} />;
}
