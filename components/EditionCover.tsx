type EditionCoverProps = {
  title: string | null;
  series?: string | null;
  volumeNumber?: string | null;
  descriptor?: string | null;
  language?: string | null;
  imageUrl?: string | null;
  imageStatus?: string | null;
  // A photograph of a copy on sale, used where a cover would be when no
  // licensed cover art exists at all -- which is every magazine issue, since
  // Jump cover art is copyrighted and no bibliographic source carries it.
  // Always badged, never treated as a cover: the record still reads as
  // missing one.
  listingPhotoUrl?: string | null;
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
  title, series, volumeNumber, descriptor, language, imageUrl, imageStatus, listingPhotoUrl, className = "", priority = false,
}: EditionCoverProps) {
  const hasVerifiedCover = Boolean(imageUrl && imageStatus === "verified");
  // Only ever a stand-in, and only when there is no cover to show. A verified
  // cover always wins.
  const showsListingPhoto = !hasVerifiedCover && Boolean(listingPhotoUrl);
  const status = imageStatus === "verified" && !imageUrl ? "missing" : imageStatus;
  const label = descriptor
    ? [series, descriptor, language].filter(Boolean).join(" · ")
    : [series, volumeNumber ? `Vol. ${volumeNumber}` : null, language].filter(Boolean).join(" · ");

  return (
    <div className={`edition-cover ${hasVerifiedCover || showsListingPhoto ? "has-image" : "is-placeholder"} ${showsListingPhoto ? "is-listing-photo" : ""} ${className}`}>
      {hasVerifiedCover ? (
        <img src={imageUrl!} alt={`Cover of ${title || series || "this publication"}`} loading={priority ? "eager" : "lazy"} referrerPolicy="no-referrer" />
      ) : showsListingPhoto ? (
        <>
          <img
            src={listingPhotoUrl!}
            alt={`A copy of ${title || series || "this publication"} photographed by a seller`}
            loading={priority ? "eager" : "lazy"}
            referrerPolicy="no-referrer"
          />
          {/* Not the "Catalogue cover" badge removed in August, which labelled
              a cover as a cover and told the reader nothing. This says the one
              thing they could not otherwise know: it is a seller's photograph
              of a used copy, not the publisher's artwork. */}
          <span className="edition-cover-listing-badge">For sale copy</span>
        </>
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
