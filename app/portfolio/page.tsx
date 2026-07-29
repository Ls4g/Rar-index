import PortfolioClient from "@/components/PortfolioClient";

export const dynamic = "force-dynamic";

type PortfolioPageProps = { searchParams: Promise<{ edition?: string | string[] }> };

export default async function PortfolioPage({ searchParams }: PortfolioPageProps) {
  const parameters = await searchParams;
  const value = parameters.edition;
  return <PortfolioClient initialEditionId={typeof value === "string" ? value : ""} />;
}
