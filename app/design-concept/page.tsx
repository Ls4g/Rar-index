import type { Metadata } from "next";
import ConceptExperience from "@/components/ConceptExperience";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "RAR design concept",
  robots: { index: false, follow: false },
};

export default function DesignConceptPage() {
  return <ConceptExperience preview />;
}
