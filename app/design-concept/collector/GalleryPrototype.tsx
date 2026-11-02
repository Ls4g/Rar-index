"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DemoBookEdition, DemoSeriesBook } from "./DemoBookShelf";
import { formatPrice } from "@/lib/fx";
import type { GalleryTheme } from "@/lib/collectorGalleryTheme";

function roomPalette(theme: GalleryTheme, night: boolean) {
  if (theme === "saffron") return night
    ? { background: "#24211d", wall: "#302b24", side: "#29251f", floor: "#211f1b", shelf: "#b9a88b", night }
    : { background: "#f5efe4", wall: "#eee5d5", side: "#e7ddcc", floor: "#e8dfd1", shelf: "#fff8eb", night };
  if (theme === "indigo") return night
    ? { background: "#1b2533", wall: "#263447", side: "#202d3e", floor: "#172130", shelf: "#9fadc1", night }
    : { background: "#eef1f6", wall: "#e5eaf2", side: "#dce4ef", floor: "#e2e8f1", shelf: "#fbfcff", night };
  return { background: "#f5f5f5", wall: "#ffffff", side: "#f5f5f5", floor: "#f0f0f0", shelf: "#f8f8f8", night };
}

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

type GalleryBook = { book: DemoSeriesBook; edition: DemoBookEdition; textureUrl: string };
type GallerySize = "three" | "wall";

function wallLayout(index: number, count: number, columns: number, size: GallerySize, focusOnly = false) {
  if (focusOnly) return { x: 0, y: 1.62, scale: 0.94 };
  if (size === "three") return { x: (index - 1) * (columns === 2 ? 0.91 : 2.65), y: 1.62, scale: columns === 2 ? 0.52 : 0.94 };
  const row = Math.floor(index / columns);
  const column = index % columns;
  const rowCount = Math.min(columns, count - row * columns);
  const rows = Math.ceil(count / columns);
  const spacious = count <= 3 && columns >= 3;
  const xStep = columns === 2 ? 1.65 : spacious ? 2.65 : 1.95;
  const stepY = columns === 2 ? 1.7 : 2.05;
  const topY = (columns === 4 ? 1.62 : 1) + (rows - 1) * stepY;
  return { x: (column - (rowCount - 1) / 2) * xStep, y: topY - row * stepY, scale: columns === 2 ? 0.6 : spacious ? 0.95 : 0.68 };
}

function Book({ exhibit, index, count, columns, size, focusOnly = false, selectedIndex, dragRotation, onInspect }: {
  exhibit: GalleryBook;
  index: number;
  count: number;
  columns: number;
  size: GallerySize;
  focusOnly?: boolean;
  selectedIndex: number | null;
  dragRotation: number;
  onInspect: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const isNarrow = useThree((state) => state.size.width < 700);
  const [coverTexture, setCoverTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let active = true;
    const texture = new THREE.TextureLoader().load(exhibit.textureUrl, (loaded) => {
      if (!active) return;
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = 8;
      loaded.needsUpdate = true;
      setCoverTexture(loaded);
    }, undefined, () => { if (active) setCoverTexture(null); });
    return () => { active = false; texture.dispose(); };
  }, [exhibit.textureUrl]);

  const selected = selectedIndex === index;
  const { x: wallX, y: wallY, scale: wallScale } = wallLayout(index, count, columns, size, focusOnly);
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
    <mesh position={[0, 0, 0.079]}><planeGeometry args={[1.50, 2.11]} /><meshBasicMaterial key={coverTexture ? "cover" : "blank"} map={coverTexture ?? undefined} color={coverTexture ? "#ffffff" : "#d8d3c9"} toneMapped={false} /></mesh>
  </group>;
}

function Shelf({ index, count, columns, size, color }: { index: number; count: number; columns: number; size: GallerySize; color: string }) {
  const { x, y, scale } = wallLayout(index, count, columns, size);
  const shelfY = y - scale * 1.055 - 0.035;
  return <mesh receiveShadow position={[x, shelfY, -0.22]}>
    <boxGeometry args={[size === "three" ? (columns === 2 ? 0.84 : 1.81) : scale * 1.85, 0.055, 0.43]} />
    <meshStandardMaterial color={color} roughness={0.85} />
  </mesh>;
}

function ExhibitLabel({ exhibit, index, count, columns, size }: { exhibit: GalleryBook; index: number; count: number; columns: number; size: GallerySize }) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fffefa";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#242829";
    context.font = "700 50px Arial, sans-serif";
    let title = exhibit.book.name;
    while (context.measureText(title).width > 474 && title.length > 1) title = `${title.slice(0, -2)}…`;
    context.fillText(title, 18, 77);
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.anisotropy = 8;
    return next;
  }, [exhibit.book.name]);
  useEffect(() => () => texture?.dispose(), [texture]);

  const { x, y, scale } = wallLayout(index, count, columns, size);
  const shelfY = y - scale * 1.055 - 0.035;
  return <group position={[x, shelfY - scale * 0.2, -0.395]} scale={scale}>
    <mesh castShadow><boxGeometry args={[1.28, 0.31, 0.025]} /><meshStandardMaterial color="#8d8c86" roughness={0.9} /></mesh>
    {texture ? <mesh position={[0, 0, 0.014]}><planeGeometry args={[1.23, 0.27]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh> : null}
  </group>;
}

function useSpotlightPool() {
  const texture = useMemo(() => {
    const side = 128;
    const pixels = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const dx = (x - side / 2) / (side / 2);
      const dy = (y - side / 2) / (side / 2);
      const strength = Math.max(0, 1 - dx * dx - dy * dy);
      const offset = (y * side + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 246;
      pixels[offset + 2] = 227;
      pixels[offset + 3] = Math.round(255 * strength * strength);
    }
    const result = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
    result.needsUpdate = true;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function usePlasterTexture() {
  const texture = useMemo(() => {
    const side = 128;
    const pixels = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const hash = (x * 374761393 + y * 668265263) | 0;
      const grain = 116 + ((hash ^ (hash >>> 13)) & 31);
      const offset = (y * side + x) * 4;
      pixels[offset] = grain;
      pixels[offset + 1] = grain;
      pixels[offset + 2] = grain;
      pixels[offset + 3] = 255;
    }
    const result = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
    result.wrapS = THREE.RepeatWrapping;
    result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(6, 3);
    result.needsUpdate = true;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Scene({ exhibits, size, columns, focusOnly = false, selectedIndex, dragRotation, onInspect, palette }: {
  exhibits: GalleryBook[];
  size: GallerySize;
  columns: number;
  focusOnly?: boolean;
  selectedIndex: number | null;
  dragRotation: number;
  onInspect: (index: number) => void;
  palette: ReturnType<typeof roomPalette>;
}) {
  const rows = Math.ceil(exhibits.length / columns);
  const rowStep = columns === 2 ? 1.7 : 2.05;
  const topY = (columns === 4 ? 1.62 : 1) + (rows - 1) * rowStep;
  const wallCamera = { center: (topY + (columns === 4 ? 1.62 : 1)) / 2, z: 6.7 + (rows - 1) * (columns === 2 ? 1.7 : 2.25) };
  const center = size === "three" || focusOnly ? 1.43 : wallCamera.center;
  const cameraZ = size === "three" || focusOnly ? 6.7 : wallCamera.z;
  const roomHeight = size === "three" || focusOnly ? 4.3 : 4.3 + (rows - 1) * rowStep;
  const roomWidth = size === "three" || focusOnly ? 9 : columns === 2 ? 5 : 9;
  const plaster = usePlasterTexture();
  const spotlightPool = useSpotlightPool();
  const individualLights = size === "three" || exhibits.length <= 3;
  const lightXs = individualLights ? exhibits.map((_, index) => wallLayout(index, exhibits.length, columns, size, focusOnly).x) : columns === 2 ? [-1, 1] : columns === 3 ? [-2.2, 0, 2.2] : [-2.95, -0.98, 0.98, 2.95];
  const lightTargets = useMemo(() => Array.from({ length: individualLights ? exhibits.length : columns }, () => new THREE.Object3D()), [individualLights, exhibits.length, columns]);
  return <Canvas key={`${size}-${columns}-${focusOnly}`} shadows flat dpr={[1, size === "wall" ? 1.35 : 1.7]} camera={{ position: [0, center + 0.35, cameraZ], fov: size === "three" || focusOnly ? 37 : 40 }} gl={{ antialias: true, alpha: false }} onCreated={({ camera }) => camera.lookAt(0, center, 0)}>
    <color attach="background" args={[palette.background]} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[0, center + 3, 8]} color="#ffffff" intensity={1.05} castShadow shadow-mapSize={[size === "wall" ? 1024 : 2048, size === "wall" ? 1024 : 2048]} shadow-radius={3} shadow-bias={-0.00025} />
    {lightXs.map((lightX, index) => <group key={lightX}>
      <primitive object={lightTargets[index]} position={[lightX, center, -0.4]} />
      <spotLight target={lightTargets[index]} position={[lightX, center + 2, 2.2]} color="#fff0db" angle={0.55} penumbra={0.75} intensity={3.2} />
    </group>)}
    <mesh receiveShadow position={[0, center + 0.2, -0.52]}><boxGeometry args={[roomWidth, roomHeight, 0.18]} /><meshStandardMaterial color={palette.wall} roughness={0.98} bumpMap={plaster} bumpScale={0.018} /></mesh>
    {!focusOnly ? exhibits.map((_, index) => {
      const { x, y, scale } = wallLayout(index, exhibits.length, columns, size);
      return <mesh key={`pool-${index}`} position={[x, y + scale * 0.22, -0.417]} raycast={() => {}}>
        <planeGeometry args={[scale * 3.1, scale * 3.5]} />
        <meshBasicMaterial map={spotlightPool} transparent opacity={palette.night ? 0.3 : 0.17} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>;
    }) : null}
    <mesh receiveShadow position={[-roomWidth / 2, center + 0.2, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, roomHeight, 0.13]} /><meshStandardMaterial color={palette.side} roughness={1} /></mesh>
    <mesh receiveShadow position={[roomWidth / 2, center + 0.2, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, roomHeight, 0.13]} /><meshStandardMaterial color={palette.side} roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 9]} /><meshStandardMaterial color={palette.floor} roughness={1} /></mesh>
    {!focusOnly ? <group position={[0, center + roomHeight / 2 - 0.12, -0.24]}>
      <mesh><boxGeometry args={[roomWidth - 0.65, 0.022, 0.035]} /><meshStandardMaterial color="#242628" roughness={0.65} /></mesh>
      {lightXs.map((lightX) => <group key={lightX} position={[lightX, -0.065, 0.045]}>
        <mesh rotation={[0.3, 0, 0]}><cylinderGeometry args={[0.048, 0.065, 0.12, 12]} /><meshStandardMaterial color="#303234" roughness={0.65} /></mesh>
        <mesh position={[0, -0.07, 0.025]}><sphereGeometry args={[0.044, 12, 8]} /><meshBasicMaterial color="#fff1cd" toneMapped={false} /></mesh>
      </group>)}
    </group> : null}
    {exhibits.map((exhibit, index) => <group key={exhibit.edition.id}>
      {focusOnly ? null : <Shelf index={index} count={exhibits.length} columns={columns} size={size} color={palette.shelf} />}
      {focusOnly ? null : <ExhibitLabel exhibit={exhibit} index={index} count={exhibits.length} columns={columns} size={size} />}
      <Book exhibit={exhibit} index={index} count={exhibits.length} columns={columns} size={size} focusOnly={focusOnly} selectedIndex={selectedIndex} dragRotation={dragRotation} onInspect={() => onInspect(index)} />
    </group>)}
  </Canvas>;
}

export default function GalleryPrototype({ books, wallEditions, ownerName, galleryTitle = "", galleryCaption = "", galleryComments = {}, galleryTheme = "studio", isDemo = true }: {
  books: DemoSeriesBook[];
  wallEditions?: DemoBookEdition[];
  ownerName?: string;
  galleryTitle?: string;
  galleryCaption?: string;
  galleryComments?: Record<string, string>;
  galleryTheme?: GalleryTheme;
  isDemo?: boolean;
}) {
  const exhibits: GalleryBook[] = isDemo ? EXHIBITS.flatMap((exhibit) => {
    const book = books.find((item) => item.name.toLowerCase() === exhibit.series.toLowerCase());
    const edition = "volume" in exhibit
      ? book?.owned.find((item) => item.volumeNumber === exhibit.volume)
      : book?.representative;
    return book && edition ? [{ book, edition, textureUrl: `/design-concept/collector/cover-texture?book=${exhibit.texture}` }] : [];
  }) : (wallEditions ?? []).flatMap((edition) => {
    const book = books.find((item) => item.owned.some((owned) => owned.id === edition.id));
    return book ? [{ book, edition, textureUrl: `/design-concept/collector/cover-texture?editionId=${edition.id}` }] : [];
  });
  const [size, setSize] = useState<GallerySize>("wall");
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [isMedium, setIsMedium] = useState(() => window.matchMedia("(max-width: 1050px)").matches);
  const [visitorNight, setVisitorNight] = useState(() => document.documentElement.getAttribute("data-theme") === "night");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragRotation, setDragRotation] = useState(0);
  const dragStart = useRef<{ x: number; rotation: number } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setVisitorNight(document.documentElement.getAttribute("data-theme") === "night"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

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

  if (!exhibits.length) return null;
  const collection = isDemo && size === "three" ? exhibits.filter((exhibit) => exhibit.edition.id === exhibit.book.representative.id).slice(0, 3) : exhibits;
  const columns = isNarrow ? 2 : isMedium ? 3 : 4;
  const rows = Math.ceil(collection.length / columns);
  const selected = selectedIndex === null ? null : collection[selectedIndex];
  const edition = selected?.edition;
  const collectorNote = edition ? galleryComments[edition.id]?.trim() : "";
  const price = edition?.marketGuide
    ? `${formatPrice(edition.marketGuide.median, edition.marketGuide.currency)} median · ${edition.marketGuide.saleCount} verified sales`
    : "No comparable sales guide yet";
  const returnToWall = () => { setSelectedIndex(null); setDragRotation(0); };
  const inspect = (index: number) => { setSelectedIndex(index); setDragRotation(0); };
  const changeSize = (next: GallerySize) => { setSize(next); returnToWall(); };
  const galleryStyle = { "--rar-gallery-rows": rows } as CSSProperties;
  const palette = roomPalette(galleryTheme, visitorNight);
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectedIndex === null) return;
    dragStart.current = { x: event.clientX, rotation: dragRotation };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setDragRotation(THREE.MathUtils.clamp(dragStart.current.rotation + (event.clientX - dragStart.current.x) / 380, -0.62, 0.62));
  };

  return <section className="rar-gallery" id="gallery" data-gallery-theme={galleryTheme} aria-labelledby="rar-gallery-title"><div className="rar-concept-container">
    <div className="rar-gallery-intro"><div><p className="rar-concept-kicker">{isDemo ? `A COLLECTOR’S GALLERY / ${size === "three" ? "THREE-BOOK" : "SINGLE-WALL"} STUDY` : `${ownerName?.toUpperCase() ?? "COLLECTOR"}’S GALLERY`}</p><h2 id="rar-gallery-title">{galleryTitle.trim() || (isDemo ? "The Opening Chapter" : `${ownerName ?? "Collector"}'s gallery`)}</h2>{galleryCaption.trim() ? <p className="rar-gallery-caption">{galleryCaption}</p> : null}</div><p>{isDemo && size === "three" ? "Three real editions on the wall." : `${collection.length} ${collection.length === 1 ? "edition" : "editions"} on one continuous wall.`} Choose a book to bring it closer and explore its exact catalogue record.</p></div>
    {isDemo ? <div className="rar-gallery-options" aria-label="Gallery size">
      <span>EXPLORE THE SPACE</span>
      <div className="rar-gallery-size-switch"><button type="button" aria-pressed={size === "three"} onClick={() => changeSize("three")}>3 editions</button><button type="button" aria-pressed={size === "wall"} onClick={() => changeSize("wall")}>{exhibits.length} on one wall</button></div>
      <small>A display study, not a membership limit.</small>
    </div> : null}
    <div className="rar-gallery-stage" style={galleryStyle} data-size={size} data-columns={columns} data-inspecting={size === "three" && selectedIndex !== null}>
      <div className="rar-gallery-canvas" onPointerDown={size === "three" ? pointerDown : undefined} onPointerMove={size === "three" ? pointerMove : undefined} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
        <Scene exhibits={collection} size={size} columns={columns} selectedIndex={size === "three" ? selectedIndex : null} dragRotation={dragRotation} onInspect={inspect} palette={palette} />
      </div>
      <div className="rar-gallery-brand" aria-hidden="true"><b>R</b><span>{ownerName?.toUpperCase() ?? "THE OPENING CHAPTER"}<br />{collection.length} EDITIONS / ONE WALL</span></div>
      {size === "wall" || selectedIndex === null ? <div className={`rar-gallery-exhibits ${size === "wall" ? "is-wall" : ""}`} style={{ gridTemplateColumns: `repeat(${size === "wall" ? columns : 3}, minmax(0, 1fr))`, gridTemplateRows: size === "wall" ? `repeat(${rows}, minmax(0, 1fr))` : undefined }} aria-label="Choose an edition to inspect">{collection.map((exhibit, index) => <button type="button" key={exhibit.edition.id} aria-label={`Inspect ${exhibit.book.name}, volume ${exhibit.edition.volumeNumber || "1"}`} onClick={() => inspect(index)}><span>{String(index + 1).padStart(2, "0")} / EXHIBIT</span><strong>{exhibit.book.name}</strong><small>Vol. {exhibit.edition.volumeNumber || "1"} · Inspect ↗</small></button>)}</div> : null}
      {size === "three" && selected && edition ? <aside className="rar-gallery-details" aria-label="Edition details">
        <button className="rar-gallery-return" type="button" onClick={returnToWall}>← Return to wall</button>
        <p className="rar-concept-kicker">ON THE WALL / {String(selectedIndex! + 1).padStart(2, "0")}</p>
        <h3>{selected.book.name}<br /><em>Vol. {edition.volumeNumber || "1"}</em></h3>
        <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
        <p className="rar-gallery-edition-copy">{isDemo ? "One exact edition from RAR’s catalogue, shown here as part of a fictional collector gallery." : `An edition ${ownerName ?? "this collector"} chose to display from their RAR shelf.`}</p>
        {collectorNote ? <div className="rar-gallery-collector-note"><span>FROM @{ownerName}</span><p>{collectorNote}</p></div> : null}
        <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
        <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
        <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
      </aside> : null}
    </div>
    <dialog ref={dialogRef} className="rar-gallery-focus" onClose={returnToWall} aria-label={selected ? `Inspect ${selected.book.name}, volume ${edition?.volumeNumber || "1"}` : "Inspect a book"}>
      {size === "wall" && selected && edition ? <div className="rar-gallery-focus-inner">
        <div className="rar-gallery-focus-visual" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
          <Scene exhibits={[selected]} size="three" columns={3} focusOnly selectedIndex={0} dragRotation={dragRotation} onInspect={() => {}} palette={palette} />
        </div>
        <aside className="rar-gallery-details" aria-label="Edition details">
          <button className="rar-gallery-return" type="button" onClick={returnToWall}>← Return to gallery wall</button>
          <p className="rar-concept-kicker">ON THE WALL / {String(selectedIndex! + 1).padStart(2, "0")}</p>
          <h3>{selected.book.name}<br /><em>Vol. {edition.volumeNumber || "1"}</em></h3>
          <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
          <p className="rar-gallery-edition-copy">{isDemo ? "One exact edition from RAR’s catalogue, shown here as part of a fictional collector gallery." : `An edition ${ownerName ?? "this collector"} chose to display from their RAR shelf.`}</p>
          {collectorNote ? <div className="rar-gallery-collector-note"><span>FROM @{ownerName}</span><p>{collectorNote}</p></div> : null}
          <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
          <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
          <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
        </aside>
      </div> : null}
    </dialog>
    <div className="rar-gallery-footnote"><span>{isDemo ? "FICTIONAL GALLERY · VERIFIED RAR COVERS · NO OWNERSHIP CLAIM" : "COLLECTOR’S CHOSEN DISPLAY · VERIFIED RAR COVERS"}</span><span>{isDemo ? `${collection.length}-BOOK INTERACTION STUDY` : `${collection.length} ON DISPLAY`}</span></div>
  </div></section>;
}
