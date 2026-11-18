import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import { SITE_OPERATOR } from "@/lib/siteOperator";

export const metadata: Metadata = { title: "Privacy policy — RAR Index", description: "What personal data RAR Index collects, why, and your rights." };

export default function PrivacyPage() {
  const email = <a href={`mailto:${SITE_OPERATOR.email}`}>{SITE_OPERATOR.email}</a>;
  return <main className="public-page">
    <PublicHeader />
    <section className="tool-hero">
      <p className="eyebrow">Privacy policy</p>
      <h1>Your data on RAR Index.</h1>
      <p>What we collect, why, who else handles it, and your rights. Last updated {SITE_OPERATOR.updated}.</p>
    </section>
    <section className="tool-content legal-copy">
      <h2>Who is responsible</h2>
      <p>This website is run by {SITE_OPERATOR.name} ("we" or "us"), the controller of personal data described here under UK data protection law (the UK GDPR and the Data Protection Act 2018). Contact: {email}.</p>

      <h2>You can browse without an account</h2>
      <p>Reading the catalogue and prices needs no account. We do not use advertising or third-party tracking cookies, and we do not sell personal data.</p>

      <h2>What we collect, and why</h2>
      <ul>
        <li><strong>Collector account</strong> (if you create one): your email address and password, and the username you choose. The password is stored by our database provider in hashed form; we cannot see it. Used to run your account (contract).</li>
        <li><strong>Your shelf</strong>: the editions you add, and any condition, purchase price, date or notes you enter. Purchase prices, dates and private notes are never shown publicly. Used to provide the collection features you ask for (contract).</li>
        <li><strong>Public gallery</strong> (only if you turn it on): your username, the editions you choose to display, your gallery title and captions. Signed-in collectors can like a gallery and post comments on it, which are shown with the commenter's username. Off by default (contract, and your choice to publish).</li>
        <li><strong>Requests and reports</strong>: if you request a manga or report a sale, we keep what you type in the form. To stop abuse we also keep a one-way scrambled (hashed) version of your internet address for a short time, used only to limit how many submissions one connection can send (legitimate interests).</li>
        <li><strong>Visit counts</strong>: the site records anonymous events such as "a visitor opened an edition page", with no identifier, address or cookie attached (legitimate interests).</li>
        <li><strong>Settings stored in your browser</strong>: your Day/Night choice is kept in a cookie and local storage. Signed-in collectors and staff have a sign-in cookie. These are strictly necessary for the site to work as you set it.</li>
      </ul>

      <h2>Sales and listings data</h2>
      <p>Prices on RAR come from completed public listings, mainly on eBay. We keep the listing title, price, date, condition and a link to the listing. We do not collect buyers' or sellers' contact details, and seller usernames are not kept in RAR's sales or listing records. If eBay tells us an account has been closed and its data must be deleted, we act on that notice.</p>

      <h2>Who else handles your data</h2>
      <ul>
        <li><strong>Supabase</strong> hosts the database and sign-in, in the European Union (Ireland).</li>
        <li><strong>Vercel</strong> hosts the website and processes requests to it. Vercel is based in the United States; transfers are covered by its data processing terms and the safeguards they provide.</li>
      </ul>
      <p>Covers and book details may be loaded from publisher and book-database websites; those requests come from our servers or your browser and carry no RAR account information.</p>

      <h2>How long we keep it</h2>
      <p>Account and shelf data stay until you delete them or ask us to delete your account. Gallery comments stay until removed by their author, the gallery owner or us. Hashed internet addresses used for rate limiting are kept only as long as that limit needs them. Anonymous visit counts are kept as statistics.</p>

      <h2>Your rights</h2>
      <p>You can ask to see, correct, export or delete your personal data, object to or restrict how we use it, and withdraw any consent. Email {email} from the address on your account. We will reply within one month.</p>
      <p>If you are unhappy with how we handle your data, you can complain to the Information Commissioner's Office (ico.org.uk). We would appreciate the chance to put it right first.</p>

      <h2>Children</h2>
      <p>Collector accounts are for people aged 13 or over.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we will update the date above and, for significant changes, tell signed-in collectors. See also the <Link href="/terms">Terms of use</Link>.</p>
    </section>
  </main>;
}
