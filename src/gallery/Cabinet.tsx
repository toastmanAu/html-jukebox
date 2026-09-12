import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
/** A working mechanism behind the cabinet's glass; all controls remain accessible DOM. */
function Mechanism({ selection, reduced, launching }: { selection: number; reduced: boolean; launching: boolean }) {
  const record = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => { invalidate(); }, [selection, launching, reduced, invalidate]);
  useFrame((_state, delta) => {
    if (!record.current || !arm.current) return;
    const target = selection * .35 + (launching ? 1.3 : 0), tone = launching ? -.2 : .12;
    record.current.rotation.z = reduced ? target : THREE.MathUtils.damp(record.current.rotation.z, target, 5, Math.min(delta, .05));
    arm.current.rotation.z = reduced ? tone : THREE.MathUtils.damp(arm.current.rotation.z, tone, 6, Math.min(delta, .05));
    if (Math.abs(record.current.rotation.z - target) > .001 || Math.abs(arm.current.rotation.z - tone) > .001) invalidate();
  });
  return <><ambientLight intensity={1.2}/><directionalLight position={[-2, 4, 5]} intensity={4} color="#ffe3b3"/><pointLight position={[3, 1, 2]} intensity={12} color="#7de0c2"/>
    <mesh position={[0, 0, -.15]}><boxGeometry args={[7, 3, .15]}/><meshStandardMaterial color="#503b25" metalness={.6} roughness={.35}/></mesh>
    {[-2.4, -2.15, -1.9, 1.9, 2.15, 2.4].map(x => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[.1, 2.2, .12]}/><meshStandardMaterial color="#c7b284" metalness={.85} roughness={.23}/></mesh>)}
    <group ref={record} rotation={[0, 0, selection * .35]}>
      <mesh><circleGeometry args={[1.35, 96]}/><meshStandardMaterial color="#101311" metalness={.25} roughness={.35}/></mesh>
      {[.56,.69,.82,.95,1.08,1.2,1.3].map(r => <mesh key={r} position={[0,0,.005]}><torusGeometry args={[r,.008,4,96]}/><meshStandardMaterial color="#53584a" metalness={.65} roughness={.3}/></mesh>)}
      <mesh position={[0,0,.015]}><circleGeometry args={[.43,48]}/><meshStandardMaterial color="#c06c3d" roughness={.55}/></mesh>
      <mesh position={[0,0,.03]}><circleGeometry args={[.12,24]}/><meshStandardMaterial color="#e1c892" metalness={.8} roughness={.2}/></mesh>
      <mesh position={[0,.25,.035]}><boxGeometry args={[.37,.055,.01]}/><meshStandardMaterial color="#e5d3a0"/></mesh>
    </group>
    <group ref={arm} position={[1.4,.7,.16]}>
      <mesh><cylinderGeometry args={[.15,.15,.15,24]}/><meshStandardMaterial color="#c0c7b9" metalness={.95} roughness={.2}/></mesh>
      <mesh position={[-.45,-.56,.1]} rotation={[0,0,-.64]}><boxGeometry args={[.08,1.5,.09]}/><meshStandardMaterial color="#d2d8c9" metalness={.9} roughness={.2}/></mesh>
      <mesh position={[-.91,-1.13,.1]} rotation={[0,0,-.64]}><boxGeometry args={[.22,.32,.12]}/><meshStandardMaterial color="#263b31" metalness={.45}/></mesh>
    </group>
  </>;
}
export default function Cabinet(props: { selection: number; reduced: boolean; launching: boolean }) {
  return <Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[0,0,7],fov:30}} gl={{antialias:true,powerPreference:'low-power',alpha:true}} aria-hidden="true"><Mechanism {...props}/></Canvas>;
}
