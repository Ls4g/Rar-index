"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DemoSeriesBook } from "./DemoBookShelf";
import { formatPrice } from "@/lib/fx";

const EXHIBITS = [
  { series: "One Piece", texture: "one-piece" },
  { series: "Dragon Ball", texture: "dragon-ball" },
  { series: "Naruto", texture: "naruto" },
] as const;

type GalleryBook = { book: DemoSeriesBook; texture: string };

function Book({ exhibit, index, selectedIndex, dragRotation, onInspect }: {
  exhibit: GalleryBook;
  index: number;
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
  const wallX = (index - 1) * (isNarrow ? 0.91 : 2.12);
  const wallScale = isNarrow ? 0.52 : 0.94;
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, selected ? (isNarrow ? 0 : -0.75) : wallX, 4.2, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, selected ? (isNarrow ? 1.8 : 1.57) : 1.62, 4.2, delta);
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, selected ? (isNarrow ? 1.9 : 2.45) : 0, 4.2, delta);
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, selected ? -0.2 + dragRotation : -0.08, 5.4, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, selected ? -0.035 : 0, 4.2, delta);
    ref.current.scale.setScalar(THREE.MathUtils.damp(ref.current.scale.x, selected ? (isNarrow ? 1.08 : 1.15) : wallScale, 4.2, delta));
  });

  return <group ref={ref} position={[wallX, 1.62, 0]} rotation={[0, -0.08, 0]} scale={wallScale} onClick={(event) => {
    event.stopPropagation();
    if (selectedIndex === null) onInspect();
  }}>
    {/* The paper block sits inside two thin covers. The art reaches the front's edges. */}
    <mesh castShadow position={[0.015, 0, -0.007]}><boxGeometry args={[1.45, 2.07, 0.135]} /><meshStandardMaterial color="#f3eee2" roughness={0.96} /></mesh>
    <mesh castShadow position={[0, 0, -0.087]}><boxGeometry args={[1.50, 2.11, 0.013]} /><meshStandardMaterial color="#ad342e" roughness={0.74} /></mesh>
    <mesh castShadow position={[-0.752, 0, -0.003]}><boxGeometry args={[0.024, 2.11, 0.171]} /><meshStandardMaterial color="#a32d28" roughness={0.78} /></mesh>
    <mesh position={[0, 0, 0.079]}><planeGeometry args={[1.50, 2.11]} /><meshBasicMaterial map={coverTexture} toneMapped={false} /></mesh>
  </group>;
}

function Shelf({ index }: { index: number }) {
  const isNarrow = useThree((state) => state.size.width < 700);
  const wallScale = isNarrow ? 0.52 : 0.94;
  const shelfY = 1.62 - wallScale * 1.055 - 0.035;
  return <mesh receiveShadow position={[(index - 1) * (isNarrow ? 0.91 : 2.12), shelfY, -0.22]}>
    <boxGeometry args={[isNarrow ? 0.84 : 1.81, 0.055, 0.43]} />
    <meshStandardMaterial color="#eee9df" roughness={0.85} />
  </mesh>;
}

function Scene({ exhibits, selectedIndex, dragRotation, onInspect }: {
  exhibits: GalleryBook[];
  selectedIndex: number | null;
  dragRotation: number;
  onInspect: (index: number) => void;
}) {
  return <Canvas shadows flat dpr={[1, 1.7]} camera={{ position: [0, 1.95, 6.7], fov: 37 }} gl={{ antialias: true, alpha: false }} onCreated={({ camera }) => camera.lookAt(0, 1.43, 0)}>
    <color attach="background" args={["#faf8f3"]} />
    <ambientLight intensity={2.2} />
    <directionalLight position={[0, 4, 8]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} shadow-radius={3} shadow-bias={-0.00025} />
    <mesh receiveShadow position={[0, 1.65, -0.52]}><boxGeometry args={[9, 4.3, 0.18]} /><meshStandardMaterial color="#faf8f3" roughness={1} /></mesh>
    <mesh receiveShadow position={[-4.44, 1.65, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, 4.3, 0.13]} /><meshStandardMaterial color="#f5f2ec" roughness={1} /></mesh>
    <mesh receiveShadow position={[4.44, 1.65, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, 4.3, 0.13]} /><meshStandardMaterial color="#f5f2ec" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 9]} /><meshStandardMaterial color="#eee9e0" roughness={1} /></mesh>
    {exhibits.map((exhibit, index) => <group key={exhibit.book.representative.id}>
      <Shelf index={index} />
      <Book exhibit={exhibit} index={index} selectedIndex={selectedIndex} dragRotation={dragRotation} onInspect={() => onInspect(index)} />
    </group>)}
  </Canvas>;
}

export default function GalleryPrototype({ books }: { books: DemoSeriesBook[] }) {
  const exhibits = EXHIBITS.flatMap(({ series, texture }) => {
    const book = books.find((item) => item.name.toLowerCase() === series.toLowerCase());
    return book ? [{ book, texture }] : [];
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragRotation, setDragRotation] = useState(0);
  const dragStart = useRef<{ x: number; rotation: number } | null>(null);
  if (exhibits.length !== EXHIBITS.length) return null;
  const selected = selectedIndex === null ? null : exhibits[selectedIndex];
  const edition = selected?.book.representative;
  const price = edition?.marketGuide
    ? `${formatPrice(edition.marketGuide.median, edition.marketGuide.currency)} median · ${edition.marketGuide.saleCount} verified sales`
    : "No comparable sales guide yet";
  const returnToWall = () => { setSelectedIndex(null); setDragRotation(0); };
  const inspect = (index: number) => { setSelectedIndex(index); setDragRotation(0); };

  return <section className="rar-gallery" id="gallery" aria-labelledby="rar-gallery-title"><div className="rar-concept-container">
    <div className="rar-gallery-intro"><div><p className="rar-concept-kicker">A COLLECTOR’S GALLERY / THREE-BOOK STUDY</p><h2 id="rar-gallery-title">A room for the stories<span>.</span></h2></div><p>Three real editions on the wall. Choose one to bring it closer and explore the exact catalogue record behind the cover.</p></div>
    <div className="rar-gallery-stage" data-inspecting={selectedIndex !== null}>
      <div className="rar-gallery-canvas" onPointerDown={(event) => {
        if (selectedIndex === null) return;
        dragStart.current = { x: event.clientX, rotation: dragRotation };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!dragStart.current) return;
        setDragRotation(THREE.MathUtils.clamp(dragStart.current.rotation + (event.clientX - dragStart.current.x) / 380, -0.62, 0.62));
      }} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
        <Scene exhibits={exhibits} selectedIndex={selectedIndex} dragRotation={dragRotation} onInspect={inspect} />
      </div>
      <div className="rar-gallery-brand" aria-hidden="true"><b>R</b><span>THE OPENING CHAPTER<br />THREE EDITIONS / FIRST ROOM</span></div>
      {selectedIndex === null ? <div className="rar-gallery-exhibits" aria-label="Choose an edition to inspect">{exhibits.map((exhibit, index) => <button type="button" key={exhibit.book.representative.id} onClick={() => inspect(index)}><span>0{index + 1} / EXHIBIT</span><strong>{exhibit.book.name}</strong><small>Vol. {exhibit.book.representative.volumeNumber || "1"} · Inspect ↗</small></button>)}</div> : null}
      {selected && edition ? <aside className="rar-gallery-details" aria-label="Edition details">
        <button className="rar-gallery-return" type="button" onClick={returnToWall}>← Return to wall</button>
        <p className="rar-concept-kicker">ON THE WALL / 0{selectedIndex! + 1}</p>
        <h3>{selected.book.name}<br /><em>Vol. {edition.volumeNumber || "1"}</em></h3>
        <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
        <p className="rar-gallery-edition-copy">One exact edition from RAR’s catalogue, shown here as part of a fictional collector gallery.</p>
        <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
        <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
        <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
      </aside> : null}
    </div>
    <div className="rar-gallery-footnote"><span>FICTIONAL GALLERY · VERIFIED RAR COVERS · NO OWNERSHIP CLAIM</span><span>THREE-BOOK INTERACTION STUDY</span></div>
  </div></section>;
}
