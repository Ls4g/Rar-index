"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DemoBookEdition, DemoSeriesBook } from "./DemoBookShelf";
import { formatPrice } from "@/lib/fx";

const EXHIBITS = [
  { series: "One Piece", texture: "one-piece" },
  { series: "One Piece", volume: "2", texture: "one-piece-2" },
  { series: "Dragon Ball", texture: "dragon-ball" },
  { series: "Naruto", texture: "naruto" },
  { series: "Naruto", volume: "2", texture: "naruto-2" },
  { series: "Naruto", volume: "3", texture: "naruto-3" },
  { series: "Naruto", volume: "4", texture: "naruto-4" },
  { series: "Berserk", texture: "berserk" },
  { series: "Slam Dunk", texture: "slam-dunk" },
  { series: "Bleach", texture: "bleach" },
  { series: "Jujutsu Kaisen", texture: "jujutsu-kaisen" },
  { series: "Chainsaw Man", texture: "chainsaw-man" },
  { series: "Attack on Titan", texture: "attack-on-titan" },
  { series: "Black Clover", texture: "black-clover" },
  { series: "Kagurabachi", texture: "kagurabachi" },
  { series: "Hunter × Hunter", texture: "hunter-hunter" },
] as const;

type GalleryBook = { book: DemoSeriesBook; edition: DemoBookEdition; texture: string };
type GallerySize = "three" | "wall";

function wallLayout(index: number, columns: number, size: GallerySize, focusOnly = false) {
  if (focusOnly) return { x: 0, y: 1.62, scale: 0.94 };
  if (size === "three") return { x: (index - 1) * (columns === 2 ? 0.91 : 2.12), y: 1.62, scale: columns === 2 ? 0.52 : 0.94 };
  const row = Math.floor(index / columns);
  const column = index % columns;
  const xStep = columns === 2 ? 1.65 : 1.95;
  const topY = columns === 2 ? 12.9 : columns === 3 ? 9.5 : 6.67;
  return { x: (column - (columns - 1) / 2) * xStep, y: topY - row * (columns === 4 ? 1.68 : 1.7), scale: columns === 2 ? 0.6 : 0.68 };
}

function Book({ exhibit, index, columns, size, focusOnly = false, selectedIndex, dragRotation, onInspect }: {
  exhibit: GalleryBook;
  index: number;
  columns: number;
  size: GallerySize;
  focusOnly?: boolean;
  selectedIndex: number | null;
  dragRotation: number;
  onInspect: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const isNarrow = useThree((state) => state.size.width < 700);
  const cover = useLoader(THREE.TextureLoader, `/design-concept/collector/cover-texture?book=${exhibit.texture}`);
  const coverTexture = useMemo(() => {
    const texture = cover.clone();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }, [cover]);
  useEffect(() => () => coverTexture.dispose(), [coverTexture]);

  const selected = selectedIndex === index;
  const { x: wallX, y: wallY, scale: wallScale } = wallLayout(index, columns, size, focusOnly);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, selected ? (isNarrow ? 0 : -0.75) : wallX, 4.2, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, selected ? (isNarrow ? 1.8 : 1.57) : wallY, 4.2, delta);
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, selected ? (isNarrow ? 1.9 : 2.45) : 0, 4.2, delta);
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, selected ? -0.2 + dragRotation : -0.08, 5.4, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, selected ? -0.035 : 0, 4.2, delta);
    ref.current.scale.setScalar(THREE.MathUtils.damp(ref.current.scale.x, selected ? (isNarrow ? 1.08 : 1.15) : wallScale, 4.2, delta));
  });

  return <group ref={ref} position={[wallX, wallY, 0]} rotation={[0, -0.08, 0]} scale={wallScale} onClick={(event) => {
    event.stopPropagation();
    if (selectedIndex === null) onInspect();
  }}>
    {/* The paper block sits inside two thin covers. The art reaches the front's edges. */}
    <mesh castShadow position={[0.015, 0, -0.007]}><boxGeometry args={[1.45, 2.07, 0.135]} /><meshStandardMaterial color="#f3eee2" roughness={0.96} /></mesh>
    {Array.from({ length: size === "wall" ? 4 : 10 }, (_, line) => {
      const pageZ = -0.068 + line * (size === "wall" ? 0.036 : 0.012);
      return <group key={line}>
        <mesh position={[0.743, 0, pageZ]}><boxGeometry args={[0.002, 2.04, 0.002]} /><meshBasicMaterial color="#bdb1a1" transparent opacity={0.56} depthWrite={false} /></mesh>
        <mesh position={[0.015, 1.037, pageZ]}><boxGeometry args={[1.42, 0.002, 0.002]} /><meshBasicMaterial color="#bdb1a1" transparent opacity={0.42} depthWrite={false} /></mesh>
      </group>;
    })}
    <mesh castShadow position={[0, 0, -0.087]}><boxGeometry args={[1.50, 2.11, 0.013]} /><meshStandardMaterial color="#ad342e" roughness={0.74} /></mesh>
    <mesh castShadow position={[-0.752, 0, -0.003]}><boxGeometry args={[0.024, 2.11, 0.171]} /><meshStandardMaterial color="#a32d28" roughness={0.78} /></mesh>
    <mesh position={[0, 0, 0.079]}><planeGeometry args={[1.50, 2.11]} /><meshBasicMaterial map={coverTexture} toneMapped={false} /></mesh>
  </group>;
}

function Shelf({ index, columns, size }: { index: number; columns: number; size: GallerySize }) {
  const { x, y, scale } = wallLayout(index, columns, size);
  const shelfY = y - scale * 1.055 - 0.035;
  return <mesh receiveShadow position={[x, shelfY, -0.22]}>
    <boxGeometry args={[size === "three" ? (columns === 2 ? 0.84 : 1.81) : scale * 1.85, 0.055, 0.43]} />
    <meshStandardMaterial color="#f8f8f8" roughness={0.85} />
  </mesh>;
}

function Scene({ exhibits, size, columns, focusOnly = false, selectedIndex, dragRotation, onInspect }: {
  exhibits: GalleryBook[];
  size: GallerySize;
  columns: number;
  focusOnly?: boolean;
  selectedIndex: number | null;
  dragRotation: number;
  onInspect: (index: number) => void;
}) {
  const wallCamera = columns === 2 ? { center: 7.3, z: 18.5 } : columns === 3 ? { center: 5.25, z: 14 } : { center: 3.7, z: 10.8 };
  const center = size === "three" || focusOnly ? 1.43 : wallCamera.center;
  const cameraZ = size === "three" || focusOnly ? 6.7 : wallCamera.z;
  const roomHeight = size === "three" || focusOnly ? 4.3 : columns === 2 ? 15.3 : columns === 3 ? 11.5 : 8.2;
  const roomWidth = size === "three" || focusOnly ? 9 : columns === 2 ? 5 : 9;
  return <Canvas key={`${size}-${columns}-${focusOnly}`} shadows flat dpr={[1, size === "wall" ? 1.35 : 1.7]} camera={{ position: [0, center + 0.35, cameraZ], fov: size === "three" || focusOnly ? 37 : 40 }} gl={{ antialias: true, alpha: false }} onCreated={({ camera }) => camera.lookAt(0, center, 0)}>
    <color attach="background" args={["#f5f5f5"]} />
    <ambientLight intensity={1.65} />
    <directionalLight position={[0, center + 3, 8]} color="#ffffff" intensity={1.2} castShadow shadow-mapSize={[size === "wall" ? 1024 : 2048, size === "wall" ? 1024 : 2048]} shadow-radius={3} shadow-bias={-0.00025} />
    {[-2.12, 0, 2.12].map((lightX) => <spotLight key={lightX} position={[lightX, center + 2, 2.2]} color="#ffffff" angle={0.5} penumbra={1} intensity={1.7} />)}
    <mesh receiveShadow position={[0, center + 0.2, -0.52]}><boxGeometry args={[roomWidth, roomHeight, 0.18]} /><meshStandardMaterial color="#ffffff" roughness={1} /></mesh>
    <mesh receiveShadow position={[-roomWidth / 2, center + 0.2, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, roomHeight, 0.13]} /><meshStandardMaterial color="#f5f5f5" roughness={1} /></mesh>
    <mesh receiveShadow position={[roomWidth / 2, center + 0.2, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, roomHeight, 0.13]} /><meshStandardMaterial color="#f5f5f5" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 9]} /><meshStandardMaterial color="#f0f0f0" roughness={1} /></mesh>
    {exhibits.map((exhibit, index) => <group key={exhibit.edition.id}>
      {focusOnly ? null : <Shelf index={index} columns={columns} size={size} />}
      <Book exhibit={exhibit} index={index} columns={columns} size={size} focusOnly={focusOnly} selectedIndex={selectedIndex} dragRotation={dragRotation} onInspect={() => onInspect(index)} />
    </group>)}
  </Canvas>;
}

export default function GalleryPrototype({ books }: { books: DemoSeriesBook[] }) {
  const exhibits = EXHIBITS.flatMap((exhibit) => {
    const book = books.find((item) => item.name.toLowerCase() === exhibit.series.toLowerCase());
    const edition = "volume" in exhibit
      ? book?.owned.find((item) => item.volumeNumber === exhibit.volume)
      : book?.representative;
    return book && edition ? [{ book, edition, texture: exhibit.texture }] : [];
  });
  const [size, setSize] = useState<GallerySize>("wall");
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [isMedium, setIsMedium] = useState(() => window.matchMedia("(max-width: 1050px)").matches);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragRotation, setDragRotation] = useState(0);
  const dragStart = useRef<{ x: number; rotation: number } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 700px)");
    const medium = window.matchMedia("(max-width: 1050px)");
    const update = () => { setIsNarrow(narrow.matches); setIsMedium(medium.matches); setSelectedIndex(null); };
    narrow.addEventListener("change", update);
    medium.addEventListener("change", update);
    return () => { narrow.removeEventListener("change", update); medium.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (size === "wall" && selectedIndex !== null) {
      if (!dialog.open) dialog.showModal();
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = previousOverflow; if (dialog.open) dialog.close(); };
    }
    if (dialog.open) dialog.close();
  }, [size, selectedIndex]);

  if (exhibits.length < 3) return null;
  const collection = size === "three" ? exhibits.filter((exhibit) => exhibit.edition.id === exhibit.book.representative.id).slice(0, 3) : exhibits;
  const columns = isNarrow ? 2 : isMedium ? 3 : 4;
  const rows = Math.ceil(collection.length / columns);
  const selected = selectedIndex === null ? null : collection[selectedIndex];
  const edition = selected?.edition;
  const price = edition?.marketGuide
    ? `${formatPrice(edition.marketGuide.median, edition.marketGuide.currency)} median · ${edition.marketGuide.saleCount} verified sales`
    : "No comparable sales guide yet";
  const returnToWall = () => { setSelectedIndex(null); setDragRotation(0); };
  const inspect = (index: number) => { setSelectedIndex(index); setDragRotation(0); };
  const changeSize = (next: GallerySize) => { setSize(next); returnToWall(); };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectedIndex === null) return;
    dragStart.current = { x: event.clientX, rotation: dragRotation };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setDragRotation(THREE.MathUtils.clamp(dragStart.current.rotation + (event.clientX - dragStart.current.x) / 380, -0.62, 0.62));
  };

  return <section className="rar-gallery" id="gallery" aria-labelledby="rar-gallery-title"><div className="rar-concept-container">
    <div className="rar-gallery-intro"><div><p className="rar-concept-kicker">A COLLECTOR’S GALLERY / {size === "three" ? "THREE-BOOK" : "SINGLE-WALL"} STUDY</p><h2 id="rar-gallery-title">A room for the stories<span>.</span></h2></div><p>{size === "three" ? "Three real editions on the wall." : `${collection.length} real editions on one continuous wall.`} Choose a book to bring it closer and explore its exact catalogue record.</p></div>
    <div className="rar-gallery-options" aria-label="Gallery size">
      <span>EXPLORE THE SPACE</span>
      <div className="rar-gallery-size-switch"><button type="button" aria-pressed={size === "three"} onClick={() => changeSize("three")}>3 editions</button><button type="button" aria-pressed={size === "wall"} onClick={() => changeSize("wall")}>{exhibits.length} on one wall</button></div>
      <small>A display study, not a membership limit.</small>
    </div>
    <div className="rar-gallery-stage" data-size={size} data-columns={columns} data-inspecting={size === "three" && selectedIndex !== null}>
      <div className="rar-gallery-canvas" onPointerDown={size === "three" ? pointerDown : undefined} onPointerMove={size === "three" ? pointerMove : undefined} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
        <Scene exhibits={collection} size={size} columns={columns} selectedIndex={size === "three" ? selectedIndex : null} dragRotation={dragRotation} onInspect={inspect} />
      </div>
      <div className="rar-gallery-brand" aria-hidden="true"><b>R</b><span>THE OPENING CHAPTER<br />{collection.length} EDITIONS / ONE WALL</span></div>
      {size === "wall" || selectedIndex === null ? <div className={`rar-gallery-exhibits ${size === "wall" ? "is-wall" : ""}`} style={{ gridTemplateColumns: `repeat(${size === "wall" ? columns : 3}, minmax(0, 1fr))`, gridTemplateRows: size === "wall" ? `repeat(${rows}, minmax(0, 1fr))` : undefined }} aria-label="Choose an edition to inspect">{collection.map((exhibit, index) => <button type="button" key={exhibit.edition.id} aria-label={`Inspect ${exhibit.book.name}, volume ${exhibit.edition.volumeNumber || "1"}`} onClick={() => inspect(index)}><span>{String(index + 1).padStart(2, "0")} / EXHIBIT</span><strong>{exhibit.book.name}</strong><small>Vol. {exhibit.edition.volumeNumber || "1"} · Inspect ↗</small></button>)}</div> : null}
      {size === "three" && selected && edition ? <aside className="rar-gallery-details" aria-label="Edition details">
        <button className="rar-gallery-return" type="button" onClick={returnToWall}>← Return to wall</button>
        <p className="rar-concept-kicker">ON THE WALL / {String(selectedIndex! + 1).padStart(2, "0")}</p>
        <h3>{selected.book.name}<br /><em>Vol. {edition.volumeNumber || "1"}</em></h3>
        <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
        <p className="rar-gallery-edition-copy">One exact edition from RAR’s catalogue, shown here as part of a fictional collector gallery.</p>
        <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
        <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
        <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
      </aside> : null}
    </div>
    <dialog ref={dialogRef} className="rar-gallery-focus" onClose={returnToWall} aria-label={selected ? `Inspect ${selected.book.name}, volume ${edition?.volumeNumber || "1"}` : "Inspect a book"}>
      {size === "wall" && selected && edition ? <div className="rar-gallery-focus-inner">
        <div className="rar-gallery-focus-visual" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
          <Scene exhibits={[selected]} size="three" columns={3} focusOnly selectedIndex={0} dragRotation={dragRotation} onInspect={() => {}} />
        </div>
        <aside className="rar-gallery-details" aria-label="Edition details">
          <button className="rar-gallery-return" type="button" onClick={returnToWall}>← Return to gallery wall</button>
          <p className="rar-concept-kicker">ON THE WALL / {String(selectedIndex! + 1).padStart(2, "0")}</p>
          <h3>{selected.book.name}<br /><em>Vol. {edition.volumeNumber || "1"}</em></h3>
          <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
          <p className="rar-gallery-edition-copy">One exact edition from RAR’s catalogue, shown here as part of a fictional collector gallery.</p>
          <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
          <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
          <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
        </aside>
      </div> : null}
    </dialog>
    <div className="rar-gallery-footnote"><span>FICTIONAL GALLERY · VERIFIED RAR COVERS · NO OWNERSHIP CLAIM</span><span>{collection.length}-BOOK INTERACTION STUDY</span></div>
  </div></section>;
}
