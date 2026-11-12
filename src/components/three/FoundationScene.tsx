import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/** 缓慢旋转的线框二十面体 + 稀疏点云（<300）。克制，不抢 UI。 */
function WireIcon() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    m.rotation.y += dt * 0.06
    m.rotation.x += dt * 0.02
  })
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[2, 1]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.18} />
    </mesh>
  )
}

function Particles({ count = 220 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 3.2 + Math.random() * 1.6
      const t = Math.random() * Math.PI * 2
      const p = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = r * Math.sin(p) * Math.cos(t)
      arr[i * 3 + 1] = r * Math.sin(p) * Math.sin(t)
      arr[i * 3 + 2] = r * Math.cos(p)
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [count])

  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y -= dt * 0.025
  })

  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial size={0.035} color="#888888" transparent opacity={0.55} sizeAttenuation />
    </points>
  )
}

export default function FoundationScene() {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 50 }}
      dpr={[1, 1.5]}
      frameloop={visible && !reduced ? 'always' : 'demand'}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.6} />
      <WireIcon />
      <Particles />
    </Canvas>
  )
}
