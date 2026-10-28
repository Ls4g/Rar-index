import Link from "next/link";
import StaffNav from "@/components/StaffNav";
import GalleryReportDecision from "@/components/GalleryReportDecision";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function GalleryCommentReportsPage() {
  const admin = getSupabaseAdmin();
  const { data: reports, error } = await admin.from("collector_gallery_comment_reports")
    .select("id,comment_id,reason,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(100);
  const commentIds = [...new Set((reports ?? []).map((report) => report.comment_id))];
  const { data: comments } = commentIds.length ? await admin.from("collector_gallery_comments")
    .select("id,body,profile_user_id,is_hidden").in("id", commentIds) : { data: [] };
  const profileIds = [...new Set((comments ?? []).map((comment) => comment.profile_user_id))];
  const { data: profiles } = profileIds.length ? await admin.from("collector_profiles")
    .select("user_id,username").in("user_id", profileIds) : { data: [] };
  const commentById = new Map((comments ?? []).map((comment) => [comment.id, comment]));
  const nameById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]));
  return <main className="review-page catalogue-page"><header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link><StaffNav current="/gallery-comment-reports" /></header>
    <section className="review-hero catalogue-hero"><div><p className="eyebrow">Community safety</p><h1>Gallery comment reports</h1><p>Review comments reported by signed-in collectors. Hiding removes a comment from public view; dismissing leaves it visible.</p></div></section>
    <section className="catalogue-content"><div className="review-list-section workbench-section">
      {error ? <p role="alert">Reports could not load.</p> : reports?.length ? <ul className="gallery-report-list">{reports.map((report) => {
        const comment = commentById.get(report.comment_id);
        const name = comment ? nameById.get(comment.profile_user_id) : null;
        return <li key={report.id} style={{ padding: "1rem 0", borderBottom: "1px solid currentColor" }}>
          <p><strong>{report.reason}</strong> · {new Date(report.created_at).toLocaleDateString("en-GB")} {name ? <>· <Link href={`/collectors/${name}`}>@{name}</Link></> : null}</p>
          <p>{comment?.body ?? "Comment no longer exists."}</p>
          {comment?.is_hidden ? <p>Already hidden</p> : null}
          <GalleryReportDecision reportId={report.id} />
        </li>;
      })}</ul> : <p>No open gallery comment reports.</p>}
    </div></section>
  </main>;
}
