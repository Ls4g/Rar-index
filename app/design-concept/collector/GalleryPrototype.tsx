"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DemoSeriesBook } from "./DemoBookShelf";
import { formatPrice } from "@/lib/fx";

const EDITION_ID = "816516fa-d79d-4e02-ba24-d32e9d75dd31";

function Book({ inspecting, dragRotation, onInspect }: { inspecting: boolean; dragRotation: number; onInspect: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const isNarrow = useThree((state) => state.size.width < 700);
  const cover = useLoader(THREE.TextureLoader, "/design-concept/collector/cover-texture");
  const coverTexture = useMemo(() => {
    const texture = cover.clone();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }, [cover]);
  useEffect(() => () => coverTexture.dispose(), [coverTexture]);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, inspecting && !isNarrow ? -0.8 : 0, 4.2, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, inspecting ? 1.57 : 1.66, 4.2, delta);
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, inspecting ? (isNarrow ? 0.55 : 2.35) : 0, 4.2, delta);
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, inspecting ? -0.25 + dragRotation : -0.12, 5.4, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, inspecting ? -0.045 : 0, 4.2, delta);
    ref.current.scale.setScalar(THREE.MathUtils.damp(ref.current.scale.x, inspecting && !isNarrow ? 1.12 : 1, 4.2, delta));
  });
  return <group ref={ref} position={[0, 1.66, 0]} rotation={[0, -0.12, 0]} onClick={(event) => {
    event.stopPropagation();
    if (!inspecting) onInspect();
  }}>
    <mesh castShadow position={[0, 0, -0.04]}><boxGeometry args={[1.43, 2.06, 0.18]} /><meshStandardMaterial color="#e7dfce" roughness={0.92} /></mesh>
    <mesh castShadow position={[0, 0, 0.061]}><boxGeometry args={[1.49, 2.11, 0.045]} /><meshStandardMaterial color="#e5ddd0" roughness={0.7} /></mesh>
    <mesh castShadow position={[-0.757, 0, -0.018]}><boxGeometry args={[0.048, 2.11, 0.2]} /><meshStandardMaterial color="#9b2925" roughness={0.72} /></mesh>
    <mesh position={[0, 0, 0.103]}><planeGeometry args={[1.445, 2.055]} /><meshBasicMaterial map={coverTexture} /></mesh>
    <mesh position={[0, 0, -0.14]} rotation={[0, Math.PI, 0]}><planeGeometry args={[1.47, 2.1]} /><meshStandardMaterial color="#a8302b" roughness={0.75} /></mesh>
  </group>;
}

function Scene({ inspecting, dragRotation, onInspect }: { inspecting: boolean; dragRotation: number; onInspect: () => void }) {
  return <Canvas shadows dpr={[1, 1.7]} camera={{ position: [0, 1.95, 6.7], fov: 37 }} gl={{ antialias: true, alpha: false }} onCreated={({ camera }) => camera.lookAt(0, 1.43, 0)}>
    <color attach="background" args={["#e9e5dc"]} />
    <ambientLight intensity={0.75} />
    <directionalLight position={[-3, 5, 5]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.00025} />
    <spotLight position={[2.4, 4.4, 3]} angle={0.35} penumbra={0.8} intensity={8} />
    <mesh receiveShadow position={[0, 1.65, -0.52]}><boxGeometry args={[9, 4.3, 0.18]} /><meshStandardMaterial color="#ddd8ce" roughness={1} /></mesh>
    <mesh receiveShadow position={[-4.44, 1.65, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, 4.3, 0.13]} /><meshStandardMaterial color="#d2cdc3" roughness={1} /></mesh>
    <mesh receiveShadow position={[4.44, 1.65, 1.22]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[3.5, 4.3, 0.13]} /><meshStandardMaterial color="#d2cdc3" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 9]} /><meshStandardMaterial color="#c9c5bd" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, 0.27, -0.22]}><boxGeometry args={[2.25, 0.075, 0.48]} /><meshStandardMaterial color="#b9b1a2" roughness={0.7} /></mesh>
    <mesh receiveShadow position={[0, 0.13, -0.41]}><boxGeometry args={[2.22, 0.3, 0.1]} /><meshStandardMaterial color="#d0c8b9" roughness={0.9} /></mesh>
    <Book inspecting={inspecting} dragRotation={dragRotation} onInspect={onInspect} />
  </Canvas>;
}

export default function GalleryPrototype({ books }: { books: DemoSeriesBook[] }) {
  const book = books.find((item) => item.representative.id === EDITION_ID);
  const [inspecting, setInspecting] = useState(false);
  const [dragRotation, setDragRotation] = useState(0);
  const dragStart = useRef<{ x: number; rotation: number } | null>(null);
  if (!book) return null;
  const edition = book.representative;
  const price = edition.marketGuide
    ? `${formatPrice(edition.marketGuide.median, edition.marketGuide.currency)} median · ${edition.marketGuide.saleCount} verified sales`
    : "No comparable sales guide yet";
  return <section className="rar-gallery" id="gallery" aria-labelledby="rar-gallery-title"><div className="rar-concept-container">
    <div className="rar-gallery-intro"><div><p className="rar-concept-kicker">A COLLECTOR’S GALLERY / FIRST STUDY</p><h2 id="rar-gallery-title">A room for the stories<span>.</span></h2></div><p>One real edition, presented as an object worth looking at. This is the first test of a more immersive public portfolio.</p></div>
    <div className="rar-gallery-stage" data-inspecting={inspecting}>
      <div className="rar-gallery-canvas" onPointerDown={(event) => {
        if (!inspecting) return;
        dragStart.current = { x: event.clientX, rotation: dragRotation };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!dragStart.current) return;
        setDragRotation(THREE.MathUtils.clamp(dragStart.current.rotation + (event.clientX - dragStart.current.x) / 380, -0.62, 0.62));
      }} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}>
        <Scene inspecting={inspecting} dragRotation={dragRotation} onInspect={() => setInspecting(true)} />
      </div>
      <div className="rar-gallery-brand" aria-hidden="true"><b>R</b><span>THE OPENING CHAPTER<br />EXHIBIT 01 / ONE PIECE</span></div>
      <div className="rar-gallery-plaque"><span>EXHIBIT 01 / 01</span><strong>One Piece</strong><small>Vol. 1 · VIZ Media · English</small></div>
      {!inspecting ? <button className="rar-gallery-inspect" type="button" onClick={() => setInspecting(true)}>Inspect this edition <span aria-hidden="true">↗</span></button> : null}
      {inspecting ? <aside className="rar-gallery-details" aria-label="Edition details">
        <button className="rar-gallery-return" type="button" onClick={() => { setInspecting(false); setDragRotation(0); }}>← Return to wall</button>
        <p className="rar-concept-kicker">ON THE WALL / 01</p>
        <h3>One Piece<br /><em>Vol. 1</em></h3>
        <p className="rar-gallery-edition-line">{edition.publisher} · {edition.language} · Volume {edition.volumeNumber}</p>
        <p className="rar-gallery-edition-copy">The beginning of Eiichiro Oda’s pirate adventure, shown here as the exact English edition in RAR’s catalogue.</p>
        <div className="rar-gallery-market"><span>RAR MARKET CONTEXT</span><strong>{price}</strong></div>
        <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
        <small className="rar-gallery-drag-hint">Drag the book to turn it</small>
      </aside> : null}
    </div>
    <div className="rar-gallery-footnote"><span>FICTIONAL GALLERY · VERIFIED RAR COVER · NO OWNERSHIP CLAIM</span><span>ONE-BOOK INTERACTION STUDY</span></div>
  </div></section>;
}
