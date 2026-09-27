import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL is required");
  const connectionUrl = new URL(url);
  // PrismaPg sends/reads timestamptz text as UTC wall-clock values. The pg
  // startup option applies to every physical connection, including new pool
  // members; a one-off SET on an acquired client would not.
  connectionUrl.searchParams.set("options", "-c TimeZone=UTC");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionUrl.toString() }) });
}
