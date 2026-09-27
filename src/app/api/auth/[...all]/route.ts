import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../auth/server";

const handler = toNextJsHandler(auth);
const allowed = new Map([
  ["/api/auth/get-session", "GET"],
  ["/api/auth/sign-up/email", "POST"],
  ["/api/auth/sign-in/email", "POST"],
  ["/api/auth/sign-out", "POST"],
]);

function allowedResponse(request: Request, method: "GET" | "POST"): Response | null {
  const expected = allowed.get(new URL(request.url).pathname);
  if (!expected) return new Response(null, { status: 404 });
  if (expected !== method) return new Response(null, { status: 405, headers: { Allow: expected } });
  return null;
}

export async function GET(request: Request): Promise<Response> {
  return allowedResponse(request, "GET") ?? handler.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return allowedResponse(request, "POST") ?? handler.POST(request);
}
