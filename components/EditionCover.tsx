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

/** Marketplace photos are sale evidence, never catalogue cover art. */
export default function EditionCover({
  title, series, volumeNumber, language, imageUrl, imageStatus, className = "", priority = false,
}: EditionCoverProps) {
  const hasVerifiedCover = Boolean(imageUrl && imageStatus === "verified");
  const label = [series, volumeNumber ? `Vol. ${volumeNumber}` : null, language].filter(Boolean).join(" · ");

  return (
    <div className={`edition-cover ${hasVerifiedCover ? "has-image" : "is-placeholder"} ${className}`}>
      {hasVerifiedCover ? (
        <img src={imageUrl!} alt={`Cover of ${title || series || "this manga edition"}`} loading={priority ? "eager" : "lazy"} referrerPolicy="no-referrer" />
      ) : (
        <div className="edition-cover-fallback" aria-label={`${title || series || "Manga"} cover not yet sourced`}>
          <span>{fallbackLabel(title, series)}</span><small>{label || "RAR catalogue"}</small>
        </div>
      )}
      {hasVerifiedCover ? <span className="edition-cover-badge">Catalogue cover</span> : null}
    </div>
  );
}
