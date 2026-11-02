export const GALLERY_THEMES = [
  { id: "studio", name: "Studio", description: "RAR's original gallery" },
  { id: "saffron", name: "Saffron", description: "Warm paper and brass" },
  { id: "indigo", name: "Indigo", description: "Cool blue and silver" },
] as const;

export type GalleryTheme = (typeof GALLERY_THEMES)[number]["id"];

export function galleryTheme(value: unknown): GalleryTheme {
  return GALLERY_THEMES.find((option) => option.id === value)?.id ?? "studio";
}
