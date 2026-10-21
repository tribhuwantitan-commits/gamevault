import { Suspense, Component, useEffect, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Grid, OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Icon } from '../Icon';
import { Spinner } from '../ui';

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'fbx';

/** Extract an object URL from a string, or fall back to an S3/client-provided URL. */
export function modelFormatOf(extension: string): ModelFormat | null {
  const ext = extension.toLowerCase();
  return ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'stl' || ext === 'fbx'
    ? (ext as ModelFormat)
    : null;
}

function GltfModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

interface LoadState {
  object: THREE.Object3D | null;
  error: string | null;
  loading: boolean;
}

/** Fetch + parse non-glTF models with the three.js example loaders. */
function useLoadedObject(url: string, format: ModelFormat): LoadState {
  const [state, setState] = useState<LoadState>({ object: null, error: null, loading: true });
  const key = `${format}:${url}`;

  useEffect(() => {
    let cancelled = false;
    let object: THREE.Object3D | null = null;
    setState({ object: null, error: null, loading: true });

    const finish = (next: { object: THREE.Object3D | null; error: string | null }) => {
      if (cancelled) {
        // Dispose anything we created after unmount.
        next.object?.traverse((child) => {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose?.();
        });
        return;
      }
      object = next.object;
      setState({ ...next, loading: false });
    };

    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The file could not be loaded (HTTP ${response.status}).`);

        if (format === 'obj') {
          const text = await response.text();
          finish({ object: new OBJLoader().parse(text), error: null });
        } else if (format === 'stl') {
          const buffer = await response.arrayBuffer();
          const geometry = new STLLoader().parse(buffer);
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: '#cfd6e4', metalness: 0.1, roughness: 0.65 }),
          );
          finish({ object: mesh, error: null });
        } else if (format === 'fbx') {
          const buffer = await response.arrayBuffer();
          finish({ object: new FBXLoader().parse(buffer, '') as unknown as THREE.Object3D, error: null });
        } else {
          throw new Error('Handled by the glTF loader.');
        }
      } catch (error) {
        finish({
          object: null,
          error: error instanceof Error ? error.message : 'The model could not be parsed.',
        });
      }
    })();

    return () => {
      cancelled = true;
      object?.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
    };
  }, [key]);

  return state;
}

function LoadedModel({ url, format }: { url: string; format: Exclude<ModelFormat, 'glb' | 'gltf'> }) {
  const { object, error, loading } = useLoadedObject(url, format);
  if (error) {
    return (
      <Html center>
        <div className="max-w-[16rem] rounded-lg bg-black/75 p-3 text-center text-[11px] leading-relaxed text-white/85">
          <p className="font-semibold text-white">Could not parse this {format.toUpperCase()}</p>
          <p className="mt-1 text-white/70">
            The file may be corrupt or use an unsupported feature ({error}). Download it to inspect it in your
            DCC tool.
          </p>
        </div>
      </Html>
    );
  }
  if (loading || !object) {
    return (
      <Html center>
        <div className="flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">
          <Spinner size={13} /> Parsing {format.toUpperCase()}…
        </div>
      </Html>
    );
  }
  return <primitive object={object} />;
}

class PreviewErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'This model could not be rendered.' };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <Icon name="alert" size={18} />
          </span>
          <p className="text-sm font-medium text-ink">3D preview failed</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            {this.state.error} Compressed (Draco/KTX2) or externally-referenced models may not load in the
            browser — download the file to inspect it in your DCC tool.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const HINT: Record<ModelFormat, string> = {
  glb: 'glTF binary · textures embedded',
  gltf: 'glTF · external .bin/textures may be missing',
  obj: 'Wavefront OBJ · geometry only (MTL not applied)',
  stl: 'STL mesh · untextured',
  fbx: 'FBX · parsed in the browser (no advanced materials)',
};

/**
 * Real in-browser 3D preview:
 *   glb / gltf → three.js GLTFLoader (drei)
 *   obj / stl / fbx → three.js example loaders
 * BLEND, DAE, USDZ etc. stay download-only — they are not faked.
 */
export default function Model3DViewer({
  url,
  filename,
  format,
}: {
  url: string;
  filename: string;
  format: ModelFormat;
}) {
  const gltf = format === 'glb' || format === 'gltf';

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-[#0b0f18]">
      <PreviewErrorBoundary key={`${format}:${url}`}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [3, 2.5, 4], fov: 45 }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.setClearColor('#0b0f18');
          }}
        >
          <color attach="background" args={['#0b0f18']} />
          <hemisphereLight intensity={1.1} groundColor="#1a2030" color="#ffffff" />
          <directionalLight position={[5, 8, 4]} intensity={1.6} />
          <directionalLight position={[-6, 3, -4]} intensity={0.6} />
          <Suspense
            fallback={
              <Html center>
                <div className="flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">
                  <Spinner size={13} /> Loading model…
                </div>
              </Html>
            }
          >
            <Bounds fit clip observe margin={1.2}>
              {gltf ? <GltfModel url={url} /> : <LoadedModel url={url} format={format as 'obj' | 'stl' | 'fbx'} />}
            </Bounds>
            <Grid
              args={[20, 20]}
              cellSize={0.5}
              cellThickness={0.5}
              cellColor="#28303f"
              sectionSize={2}
              sectionThickness={1}
              sectionColor="#3a465c"
              fadeDistance={22}
              fadeStrength={1}
              infiniteGrid
              position={[0, -0.001, 0]}
            />
          </Suspense>
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      </PreviewErrorBoundary>
      <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-[10px] font-medium text-white/80">
        <Icon name="cube" size={11} /> Drag to orbit · scroll to zoom
      </div>
      <div className="pointer-events-none absolute inset-x-3 top-2 flex justify-between gap-2">
        <span className="truncate rounded-md bg-black/45 px-2 py-1 text-[10px] text-white/70">{HINT[format]}</span>
        <span className="max-w-[45%] truncate rounded-md bg-black/45 px-2 py-1 text-[10px] text-white/70">
          {filename}
        </span>
      </div>
    </div>
  );
}
