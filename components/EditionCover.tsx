type EditionCoverProps = {
  title: string | null;
  series?: string | null;
  volumeNumber?: string | null;
  language?: string | null;
  imageUrl?: string | null;
  imageStatus?: string | null;
  className?: string;
  priority?: boolean;
};

function fallbackLabel(title: string | null, series?: string | null) {
  const value = title || series || "RAR";
  return value.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0]).join("").toUpperCase();
}

const statusCopy: Record<string, { label: string; detail: string }> = {
  candidate: { label: "Cover under review", detail: "A candidate cover has been found but not yet confirmed." },
  rejected: { label: "Cover not confirmed", detail: "A candidate cover did not match this exact edition." },
  missing: { label: "Cover pending", detail: "RAR has not yet sourced a cover for this edition." },
};

function coverStatusCopy(status: string | null | undefined) {
  return statusCopy[status ?? "missing"] ?? statusCopy.missing;
}

/** Marketplace photos are sale evidence, never catalogue cover art. */
export default function EditionCover({
  title, series, volumeNumber, language, imageUrl, imageStatus, className = "", priority = false,
}: EditionCoverProps) {
  const hasVerifiedCover = Boolean(imageUrl && imageStatus === "verified");
  const status = imageStatus === "verified" && !imageUrl ? "missing" : imageStatus;
  const label = [series, volumeNumber ? `Vol. ${volumeNumber}` : null, language].filter(Boolean).join(" · ");

  return (
    <div className={`edition-cover ${hasVerifiedCover ? "has-image" : "is-placeholder"} ${className}`}>
      {hasVerifiedCover ? (
        <img src={imageUrl!} alt={`Cover of ${title || series || "this manga edition"}`} loading={priority ? "eager" : "lazy"} referrerPolicy="no-referrer" />
      ) : (
        <div className={`edition-cover-fallback status-${status ?? "missing"}`} aria-label={`${title || series || "Manga"}: ${coverStatusCopy(status).label}`}>
          <span className="edition-cover-fallback-mark">{fallbackLabel(title, series)}</span>
          <div className="edition-cover-fallback-status">
            <strong title={coverStatusCopy(status).detail}>{coverStatusCopy(status).label}</strong>
            <small>{label || "RAR catalogue"}</small>
          </div>
        </div>
      )}
      {hasVerifiedCover ? <span className="edition-cover-badge">Catalogue cover</span> : null}
    </div>
  );
}
