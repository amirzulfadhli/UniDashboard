import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { getPrisma } from "./db";
import { loadAuthConfiguration } from "./config";

const configuration = loadAuthConfiguration();

export const auth = betterAuth({
  secret: configuration.secret,
  baseURL: configuration.baseURL,
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  socialProviders: {},
  user: { modelName: "AuthUser", deleteUser: { enabled: false } },
  session: { modelName: "AuthSession" },
  account: { modelName: "AuthAccount" },
  verification: { modelName: "AuthVerification" },
});
