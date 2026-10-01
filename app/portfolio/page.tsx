import PortfolioClient from "@/components/PortfolioClient";
import { supabase } from "@/lib/supabase";
import type { AuthCover } from "@/components/portfolio/PortfolioAuth";
import "@/app/portfolio/redesign.css";

export const dynamic = "force-dynamic";

type PortfolioPageProps = { searchParams: Promise<{ edition?: string | string[] }> };

export default async function PortfolioPage({ searchParams }: PortfolioPageProps) {
  const parameters = await searchParams;
  const value = parameters.edition;
  const { data } = await supabase.from("manga_editions")
    .select("id,title,series,volume_number,language,cover_image_url,cover_verification_status")
    .eq("is_verified", true).eq("record_kind", "publication")
    .eq("cover_verification_status", "verified").not("cover_image_url", "is", null).limit(500);
  const seen = new Set<string>();
  const authCovers = ((data ?? []) as AuthCover[]).filter((edition) => {
    const key = (edition.series || edition.title || edition.id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
  return <PortfolioClient initialEditionId={typeof value === "string" ? value : ""} authCovers={authCovers} />;
}
