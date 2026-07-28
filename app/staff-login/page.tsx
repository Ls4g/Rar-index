import Link from "next/link";
import { Suspense } from "react";
import StaffLoginForm from "@/components/StaffLoginForm";

export default function StaffLoginPage() {
  return (
    <main className="review-page staff-login-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <span className="header-note">Staff access</span>
      </header>
      <section className="staff-login-card">
        <p className="eyebrow">RAR internal tools</p>
        <h1>Staff sign in</h1>
        <p>Enter the staff credentials you created in Vercel. This keeps price imports and review decisions private.</p>
        <Suspense fallback={<p className="staff-login-loading">Loading secure sign-in...</p>}>
          <StaffLoginForm />
        </Suspense>
      </section>
    </main>
  );
}
