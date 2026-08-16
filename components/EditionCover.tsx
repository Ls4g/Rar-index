type EditionCoverProps = {
  title: string | null;
  series?: string | null;
  volumeNumber?: string | null;
  descriptor?: string | null;
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

// A small, deliberately restrained set of accent colours (never the reserved
// status colours: teal/amber/blue/grey) so different series get a bit of
// visual character on their placeholder card without implying a status.
const SERIES_ACCENTS = ["#a7332a", "#c9692c", "#77883a"];

function seriesAccent(value: string | null | undefined) {
  const key = (value ?? "").trim();
  if (!key) return SERIES_ACCENTS[0];
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return SERIES_ACCENTS[hash % SERIES_ACCENTS.length];
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
  title, series, volumeNumber, descriptor, language, imageUrl, imageStatus, className = "", priority = false,
}: EditionCoverProps) {
  const hasVerifiedCover = Boolean(imageUrl && imageStatus === "verified");
  const status = imageStatus === "verified" && !imageUrl ? "missing" : imageStatus;
  const label = descriptor
    ? [series, descriptor, language].filter(Boolean).join(" · ")
    : [series, volumeNumber ? `Vol. ${volumeNumber}` : null, language].filter(Boolean).join(" · ");

  return (
    <div className={`edition-cover ${hasVerifiedCover ? "has-image" : "is-placeholder"} ${className}`}>
      {hasVerifiedCover ? (
        <img src={imageUrl!} alt={`Cover of ${title || series || "this publication"}`} loading={priority ? "eager" : "lazy"} referrerPolicy="no-referrer" />
      ) : (
        <div
          className={`edition-cover-fallback status-${status ?? "missing"}`}
          style={{ "--series-accent": seriesAccent(series || title) } as React.CSSProperties}
          aria-label={`${title || series || "Manga"}: ${coverStatusCopy(status).label}`}
        >
          <span className="edition-cover-fallback-mark">{fallbackLabel(title, series)}</span>
          <div className="edition-cover-fallback-status">
            <strong title={coverStatusCopy(status).detail}>{coverStatusCopy(status).label}</strong>
            <small>{label || "RAR catalogue"}</small>
          </div>
        </div>
      )}
      {/* No "Catalogue cover" badge. A cover does not need labelling as a
          cover — and where it mattered (that this is publisher art rather
          than a seller's photo) the provenance block says so properly, with
          the source record linked. */}
    </div>
  );
}
