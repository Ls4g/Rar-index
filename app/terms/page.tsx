import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import { SITE_OPERATOR } from "@/lib/siteOperator";

export const metadata: Metadata = { title: "Terms of use — RAR Index", description: "The rules for using RAR Index." };

export default function TermsPage() {
  return <main className="public-page">
    <PublicHeader />
    <section className="tool-hero">
      <p className="eyebrow">Terms of use</p>
      <h1>Using RAR Index.</h1>
      <p>Plain-English terms for using the site. Last updated {SITE_OPERATOR.updated}.</p>
    </section>
    <section className="tool-content legal-copy">
      <h2>Who we are</h2>
      <p>RAR Index (the "site") is run by {SITE_OPERATOR.name}. By using the site you agree to these terms. If you do not agree, please do not use it.</p>

      <h2>Prices are information, not advice</h2>
      <p>Prices on RAR are a record of past completed sales of a specific edition, checked by a person. They are not a valuation, a guarantee of what a copy will sell for, an offer to buy or sell, or financial advice. Condition, printing, grading and the market all change what a copy is worth. Check for yourself before buying or selling.</p>
      <p>We work to keep the catalogue and prices accurate, but mistakes happen. If you spot one, tell us at <a href={`mailto:${SITE_OPERATOR.email}`}>{SITE_OPERATOR.email}</a> or use the report option on an edition page.</p>

      <h2>Third-party sites</h2>
      <p>RAR links to eBay listings, publishers and other sites. We are not responsible for those sites, their content or any purchase you make on them. RAR is not affiliated with eBay or any publisher.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your password private. You are responsible for what happens on your account.</li>
        <li>Choose a username that does not impersonate anyone or cause offence.</li>
        <li>You can stop using RAR at any time and ask us to delete your account.</li>
      </ul>

      <h2>What you post</h2>
      <p>You keep ownership of what you post (gallery captions, comments, requests and reports). You let us show it on RAR so the features work. Do not post anything unlawful, abusive, misleading, or that infringes someone else's rights, and do not post other people's personal details. We may remove content or suspend accounts that break these rules.</p>

      <h2>Fair use of the site</h2>
      <p>Please do not scrape, bulk-download or resell RAR's data, attempt to break or overload the site, or get around its limits. Personal and non-commercial use of what you see is fine; for anything else, ask first.</p>

      <h2>Copyright</h2>
      <p>Cover art and manga titles belong to their creators and publishers and are shown to identify editions. If you own rights in something on RAR and want it changed or removed, email us and we will deal with it promptly. RAR's own text, layout and compiled data are ours.</p>

      <h2>Our responsibility to you</h2>
      <p>The site is provided free and "as is". We do not promise it will always be available or error-free. As far as the law allows, we are not liable for losses arising from use of the site or reliance on its prices. Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, or fraud, and nothing affects your statutory rights as a consumer.</p>

      <h2>Changes and law</h2>
      <p>We may update these terms; the date above shows the latest version. These terms are governed by the law of England and Wales, and the courts of {SITE_OPERATOR.country} have jurisdiction. See also the <Link href="/privacy">Privacy policy</Link> and <Link href="/about">About</Link>.</p>
    </section>
  </main>;
}
