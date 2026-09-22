import { useEffect, useId, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { RankedOption } from '@meltek/engine';
import { Button, Card } from '../components/primitives';

const mm = (n: number) => Number(n.toFixed(2)).toString();

function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Annular rectangular steel section, in millimetres. No invented moulded depth. */
function coreGeometry(inner: number, outer: number, width: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer / 2, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner / 2, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 128, steps: 1 });
  geometry.translate(0, 0, -width / 2);
  geometry.computeVertexNormals();
  return geometry;
}

type ModelActions = { reset: () => void; rotate: (direction: number) => void; zoom: (factor: number) => void };

export default function SelectedDesignPreview({ option }: { option: RankedOption }) {
  const container = useRef<HTMLDivElement>(null);
  const drawing = useRef<SVGSVGElement>(null);
  const actions = useRef<ModelActions | null>(null);
  const [windings, setWindings] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const id = useId().replace(/:/g, '');
  const { coreIdMm: inner, coreOdMm: outer } = option.geometry;
  const width = option.orderedWidthMm;
  const turns = option.geometry.turns;
  const valid = [inner, outer, width].every(n => Number.isFinite(n) && n > 0) && outer > inner;
  const filename = `LT-CT-${option.gradeCode}-SWG${option.swg}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  useEffect(() => {
    const host = container.current;
    if (!host || !valid) return;
    setUnavailable(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D selected core. Drag to orbit, scroll or pinch to zoom. Keyboard controls are below.');
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene();
    const model = new THREE.Group();
    scene.add(model);
    const steel = new THREE.MeshStandardMaterial({ color: 0x75b7b4, metalness: .55, roughness: .3 });
    model.add(new THREE.Mesh(coreGeometry(inner, outer, width), steel));
    // Lamination lines communicate the construction without assuming strip thickness.
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x235253, transparent: true, opacity: .42 });
    for (let n = 1; n < 12; n++) {
      const points = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(outer / 2 * Math.cos(i / 128 * Math.PI * 2), outer / 2 * Math.sin(i / 128 * Math.PI * 2), -width / 2 + width * n / 12));
      model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    }
    if (windings) {
      const copper = new THREE.MeshStandardMaterial({ color: 0xf0a45e, metalness: .65, roughness: .27 });
      const count = Math.min(48, Math.max(1, Math.round(turns)));
      const radius = Math.min((outer - inner) / 18, outer / 180);
      const clearance = radius * 2;
      const ri = Math.max(inner / 2 - clearance, radius);
      const ro = outer / 2 + clearance;
      const half = width / 2 + clearance;
      for (let n = 0; n < count; n++) {
        const angle = n / count * Math.PI * 2;
        const point = (r: number, z: number) => new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
        const curve = new THREE.CatmullRomCurve3([
          point(ri, -half + clearance), point(ri + clearance, -half), point(ro - clearance, -half), point(ro, -half + clearance),
          point(ro, half - clearance), point(ro - clearance, half), point(ri + clearance, half), point(ri, half - clearance),
        ], true, 'centripetal');
        model.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 6, true), copper));
      }
    }
    scene.add(new THREE.HemisphereLight(0xdaf9ff, 0x29445a, 3));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(outer, outer, outer * 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x58dacb, 3);
    rim.position.set(-outer, 0, -outer);
    scene.add(rim);
    const size = Math.max(outer, width);
    const camera = new THREE.PerspectiveCamera(36, 1, size / 1000, size * 30);
    const initial = new THREE.Vector3(size * 1.25, size * .85, size * 1.65);
    camera.position.copy(initial);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = size * .85;
    controls.maxDistance = size * 5;
    // Render on interaction, never a permanent animation loop.
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    controls.update();
    resize();
    host.dataset.modelReady = 'true';
    actions.current = {
      reset: () => { camera.position.copy(initial); controls.target.set(0, 0, 0); controls.update(); render(); },
      rotate: direction => { camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 12); controls.update(); render(); },
      zoom: factor => { camera.position.multiplyScalar(factor).clampLength(controls.minDistance, controls.maxDistance); controls.update(); render(); },
    };
    return () => {
      actions.current = null;
      delete host.dataset.modelReady;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      const materials = new Set<THREE.Material>();
      model.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      materials.forEach(material => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [inner, outer, width, turns, windings, valid]);

  if (!valid) return null;
  const scale = 152 / Math.max(option.inputs.finishedOdMm, outer);
  const ro = outer * scale / 2;
  const ri = inner * scale / 2;
  const fo = option.inputs.finishedOdMm * scale / 2;
  const fi = option.inputs.finishedIdMm * scale / 2;
  // Fit unusually wide side sections independently; the dimension labels remain exact.
  const sideScale = Math.min(scale, 110 / width);
  const sideW = width * sideScale;
  const sideH = outer * sideScale;
  const label = `${option.gradeLabel} · SWG ${option.swg}`;
  const dimension = (x1: number, x2: number, y: number, text: string) => <g fill="currentColor" stroke="currentColor" strokeWidth=".8">
    <path d={`M${x1} ${y-6}v12 M${x2} ${y-6}v12 M${x1} ${y}H${x2}`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`}/>
    <text x={(x1+x2)/2} y={y-9} textAnchor="middle" stroke="none" fontSize="11">{text}</text>
  </g>;
  return <div className="design-views" data-selected-model={`${option.gradeCode}:${option.swg}`}>
    <Card title="Dimensioned diagram" subtitle={label} actions={<Button size="xs" onClick={() => {
      if (!drawing.current) return;
      const clone = drawing.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.style.color = '#173e48';
      download(new XMLSerializer().serializeToString(clone), `${filename}-diagram.svg`, 'image/svg+xml');
    }}>Download SVG</Button>}>
      <div className="drawing-stage">
        <svg ref={drawing} viewBox="0 0 520 340" role="img" aria-label={`Core diagram: ID ${mm(inner)}, OD ${mm(outer)}, ordered width ${mm(width)} millimetres`}>
          <title>{label} — core dimensions in millimetres</title>
          <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M10 5L0 0v10Z" fill="currentColor"/></marker></defs>
          <g fill="none" stroke="currentColor">
            <circle cx="145" cy="165" r={ro} fill="#65c7b9" fillOpacity=".18" strokeWidth="1.5"/>
            <circle cx="145" cy="165" r={ri} fill="#9eb7bf" fillOpacity=".1" strokeWidth="1.5"/>
            <g strokeDasharray="4 4" opacity=".45"><circle cx="145" cy="165" r={fo}/><circle cx="145" cy="165" r={fi}/></g>
            <path d="M45 165H245 M145 65V265" strokeDasharray="8 4 2 4" opacity=".4"/>
            <rect x={365-sideW/2} y={165-sideH/2} width={sideW} height={sideH} fill="#65c7b9" fillOpacity=".18" strokeWidth="1.5"/>
            <path d={`M${365-sideW/2} ${165-inner*sideScale/2}h${sideW} M${365-sideW/2} ${165+inner*sideScale/2}h${sideW}`} strokeDasharray="4 4"/>
          </g>
          {dimension(145-ro,145+ro,55,`Core OD ⌀ ${mm(outer)}`)}
          {dimension(145-ri,145+ri,165,`ID ⌀ ${mm(inner)}`)}
          {dimension(365-sideW/2,365+sideW/2,55,`Width ${mm(width)}`)}
          <g fill="currentColor" fontFamily="system-ui, sans-serif" fontSize="11" textAnchor="middle">
            <text x="145" y="277">FRONT VIEW</text><text x="365" y="277">SIDE VIEW · CORE</text>
            <text x="260" y="305">Finished ID / OD: {mm(option.inputs.finishedIdMm)} / {mm(option.inputs.finishedOdMm)} mm (dashed)</text>
            <text x="260" y="325">All dimensions in mm · Width is the ordered slit width</text>
          </g>
        </svg>
      </div>
      <p className="p-4 text-xs text-[var(--text-2)]">Steel core geometry. Dashed circles show the specified finished diameters. Finished axial width, terminals and mould details are not specified.</p>
    </Card>
    <Card title="Interactive 3D model" subtitle={label} actions={<Button size="xs" onClick={() => {
      const geometry = coreGeometry(inner, outer, width);
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      download(new STLExporter().parse(mesh), `${filename}-core-mm.stl`, 'model/stl');
      geometry.dispose(); material.dispose();
    }}>Export core STL</Button>}>
      <div className="model-stage" ref={container}>
        {unavailable && <div className="absolute inset-0 z-10 grid place-items-center bg-[#0d1722] p-8 text-center text-sm text-white">3D rendering is unavailable in this browser. The dimensioned diagram and core STL export are still available.</div>}
        <div className="pointer-events-none absolute left-4 top-4 text-[11px] tracking-wider text-[#b6d8df]">{mm(inner)} ID × {mm(outer)} OD × {mm(width)} W mm</div>
        <div className="pointer-events-none absolute bottom-4 left-4 text-xs text-[#b6d8df]">Drag to orbit · Scroll / pinch to zoom</div>
      </div>
      <div className="model-toolbar">
        <Button size="xs" onClick={() => actions.current?.rotate(-1)} disabled={unavailable}>Rotate left</Button>
        <Button size="xs" onClick={() => actions.current?.rotate(1)} disabled={unavailable}>Rotate right</Button>
        <Button size="xs" onClick={() => actions.current?.zoom(.85)} disabled={unavailable}>Zoom in</Button>
        <Button size="xs" onClick={() => actions.current?.zoom(1.18)} disabled={unavailable}>Zoom out</Button>
        <Button size="xs" onClick={() => actions.current?.reset()} disabled={unavailable}>Reset view</Button>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={windings} onChange={e => setWindings(e.target.checked)}/>Show illustrative winding</label>
      </div>
      <p className="px-4 pb-4 text-xs text-[var(--text-2)]">{turns} calculated secondary turns. Copper loops and lamination lines are representative; wire diameter and routing are not manufacturing geometry. STL contains the steel core only, in mm.</p>
    </Card>
  </div>;
}
