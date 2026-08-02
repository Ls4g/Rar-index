import { createHash } from "crypto";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ENDPOINT = "https://rar-index.vercel.app/api/ebay/account-deletion";

function configuredEndpoint() {
  return process.env.EBAY_DELETION_ENDPOINT || DEFAULT_ENDPOINT;
}

function responseHeaders() {
  return { "Cache-Control": "no-store" };
}

// eBay calls this URL before saving it. The response proves that RAR controls
// both the endpoint and the verification token without exposing that token.
export async function GET(request: NextRequest) {
  const challengeCode = request.nextUrl.searchParams.get("challenge_code");
  const verificationToken = process.env.EBAY_DELETION_VERIFICATION_TOKEN;

  if (!challengeCode) {
    return Response.json({ error: "Missing eBay challenge code." }, { status: 400, headers: responseHeaders() });
  }

  if (!verificationToken) {
    return Response.json({ error: "eBay deletion verification is not configured." }, { status: 503, headers: responseHeaders() });
  }

  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(configuredEndpoint())
    .digest("hex");

  return Response.json({ challengeResponse }, { headers: responseHeaders() });
}

// RAR currently does not authenticate eBay users or persist eBay account
// identifiers. A notification is therefore acknowledged but never logged or
// stored. If RAR later stores eBay user data, this route must validate eBay's
// signature and delete the associated records before acknowledging the notice.
export async function POST() {
  return new Response(null, { status: 204, headers: responseHeaders() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: responseHeaders() });
}
