"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Renders its children straight into <body>. A fixed-position element placed
// inside a page header is positioned relative to that header whenever an
// ancestor sets a transform, filter or similar, which is how the job-health
// card ended up on top of the RAR logo instead of in the screen corner.
export default function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
