import type { NextRequest } from "next/server";

function unauthorized() {
  return new Response("Review access requires staff credentials.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="RAR Review Queue"' },
  });
}

export default function proxy(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const expectedUser = process.env.RAR_REVIEW_USERNAME;
  const expectedPassword = process.env.RAR_REVIEW_PASSWORD;

  if (!expectedUser || !expectedPassword || !authorization?.startsWith("Basic ")) {
    return unauthorized();
  }

  try {
    const [username, password] = atob(authorization.slice(6)).split(":");
    return username === expectedUser && password === expectedPassword
      ? undefined
      : unauthorized();
  } catch {
    return unauthorized();
  }
}

export const config = {
  matcher: [
    "/review/:path*",
    "/catalogue-import/:path*",
    "/catalogue-review/:path*",
    "/price-import/:path*",
    "/api/review/:path*",
    "/api/catalogue-import/:path*",
    "/api/catalogue-review/:path*",
    "/api/price-import/:path*",
  ],
};
