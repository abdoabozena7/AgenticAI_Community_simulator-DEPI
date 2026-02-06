import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// Simplex noise approximation for shader-like noise
function fbm3D(x: number, y: number, z: number, time: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 3; i++) {
    value += amplitude * Math.sin(x * frequency + time) * Math.cos(y * frequency + time * 0.8) * Math.sin(z * frequency + time * 0.6);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

interface NetworkNode {
  position: THREE.Vector3;
  connections: number[];
  level: number;
  type: number;
  size: number;
  distanceFromRoot: number;
}

interface EnergyPulse {
  origin: THREE.Vector3;
  startTime: number;
  color: THREE.Color;
  speed: number;
}

function generateNeuralNetwork(): { nodes: NetworkNode[]; connections: [number, number, number][] } {
  const nodes: NetworkNode[] = [];
  const connections: [number, number, number][] = [];

  // Root node
  nodes.push({
    position: new THREE.Vector3(0, 0, 0),
    connections: [],
    level: 0,
    type: 0,
    size: 1.5,
    distanceFromRoot: 0,
  });

  // Generate primary axes
  const primaryAxes = 6;
  const nodesPerAxis = 8;
  const axisLength = 15;

  for (let a = 0; a < primaryAxes; a++) {
    const phi = Math.acos(-1 + (2 * a) / primaryAxes);
    const theta = Math.PI * (1 + Math.sqrt(5)) * a;
    const dirVec = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );

    let prevIdx = 0;
    for (let i = 1; i <= nodesPerAxis; i++) {
      const t = i / nodesPerAxis;
      const distance = axisLength * Math.pow(t, 0.8);
      const pos = dirVec.clone().multiplyScalar(distance);
      
      const nodeIdx = nodes.length;
      nodes.push({
        position: pos,
        connections: [],
        level: i,
        type: i === nodesPerAxis ? 1 : 0,
        size: 0.7 + Math.random() * 0.3,
        distanceFromRoot: distance,
      });

      connections.push([prevIdx, nodeIdx, 1.0 - t * 0.3]);
      nodes[prevIdx].connections.push(nodeIdx);
      nodes[nodeIdx].connections.push(prevIdx);
      prevIdx = nodeIdx;
    }
  }

  // Add ring nodes
  const ringDistances = [4, 8, 12];
  const ringNodeIndices: number[][] = [];

  for (const ringDist of ringDistances) {
    const nodesInRing = Math.floor(ringDist * 2.5);
    const ringLayer: number[] = [];

    for (let i = 0; i < nodesInRing; i++) {
      const t = i / nodesInRing;
      const ringPhi = Math.acos(2 * Math.random() - 1);
      const ringTheta = 2 * Math.PI * t;
      const pos = new THREE.Vector3(
        ringDist * Math.sin(ringPhi) * Math.cos(ringTheta),
        ringDist * Math.sin(ringPhi) * Math.sin(ringTheta),
        ringDist * Math.cos(ringPhi)
      );

      const nodeIdx = nodes.length;
      nodes.push({
        position: pos,
        connections: [],
        level: Math.ceil(ringDist / 5),
        type: Math.random() < 0.4 ? 1 : 0,
        size: 0.4 + Math.random() * 0.4,
        distanceFromRoot: ringDist,
      });
      ringLayer.push(nodeIdx);
    }
    ringNodeIndices.push(ringLayer);

    // Connect ring nodes
    for (let i = 0; i < ringLayer.length; i++) {
      const nextIdx = ringLayer[(i + 1) % ringLayer.length];
      connections.push([ringLayer[i], nextIdx, 0.5]);
      nodes[ringLayer[i]].connections.push(nextIdx);
      nodes[nextIdx].connections.push(ringLayer[i]);
    }
  }

  // Connect rings to axes
  for (const ring of ringNodeIndices) {
    for (const nodeIdx of ring) {
      const node = nodes[nodeIdx];
      let closestIdx = -1;
      let minDist = Infinity;

      for (let i = 1; i < nodes.length; i++) {
        const other = nodes[i];
        if (other.level === 0 || other.type !== 0) continue;
        const dist = node.position.distanceTo(other.position);
        if (dist < minDist && dist < 6) {
          minDist = dist;
          closestIdx = i;
        }
      }

      if (closestIdx !== -1 && !nodes[nodeIdx].connections.includes(closestIdx)) {
        connections.push([nodeIdx, closestIdx, 0.5 + (1 - minDist / 6) * 0.3]);
        nodes[nodeIdx].connections.push(closestIdx);
        nodes[closestIdx].connections.push(nodeIdx);
      }
    }
  }

  return { nodes, connections };
}

function NetworkNodes({ 
  nodes, 
  pulseIntensity,
  energyPulses,
}: { 
  nodes: NetworkNode[]; 
  pulseIntensity: number;
  energyPulses: EnergyPulse[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => new Float32Array(nodes.length * 3), [nodes.length]);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;

    nodes.forEach((node, i) => {
      dummy.position.copy(node.position);
      
      // Add subtle movement with reality-warping effect
      const noise = fbm3D(node.position.x * 0.1, node.position.y * 0.1, node.position.z * 0.1, time * 0.2);
      const warpIntensity = Math.sin(time * 0.3) * 0.5 + 0.5;
      dummy.position.x += noise * 0.15 + Math.sin(time * 2 + i * 0.1) * 0.05 * warpIntensity;
      dummy.position.y += Math.sin(time * 0.5 + node.distanceFromRoot * 0.2) * 0.1;
      dummy.position.z += noise * 0.1 + Math.cos(time * 1.5 + i * 0.15) * 0.05 * warpIntensity;

      // Calculate energy pulse effects
      let pulseEffect = 0;
      let pulseColorR = 1, pulseColorG = 1, pulseColorB = 1;
      
      for (const pulse of energyPulses) {
        const timeSincePulse = time - pulse.startTime;
        if (timeSincePulse < 0 || timeSincePulse > 3) continue;
        
        const pulseRadius = timeSincePulse * pulse.speed;
        const distFromPulse = node.position.distanceTo(pulse.origin);
        const pulseThickness = 2.5;
        const waveProximity = Math.abs(distFromPulse - pulseRadius);
        
        if (waveProximity < pulseThickness) {
          const effect = (1 - waveProximity / pulseThickness) * (1 - timeSincePulse / 3);
          if (effect > pulseEffect) {
            pulseEffect = effect;
            pulseColorR = pulse.color.r;
            pulseColorG = pulse.color.g;
            pulseColorB = pulse.color.b;
          }
        }
      }

      // Scale with pulse
      const basePulse = 1 + Math.sin(time * 2 + node.distanceFromRoot * 0.3) * 0.1;
      const scale = node.size * basePulse * (1 + pulseIntensity * 0.5) * (1 + pulseEffect * 2);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      // Colors with energy pulse coloring
      const baseIntensity = 0.6 + Math.sin(time + node.distanceFromRoot * 0.2) * 0.2 + pulseIntensity * 0.3;
      
      if (pulseEffect > 0) {
        colors[i * 3] = THREE.MathUtils.lerp(baseIntensity, pulseColorR * 2, pulseEffect);
        colors[i * 3 + 1] = THREE.MathUtils.lerp(baseIntensity, pulseColorG * 2, pulseEffect);
        colors[i * 3 + 2] = THREE.MathUtils.lerp(baseIntensity, pulseColorB * 2, pulseEffect);
      } else {
        colors[i * 3] = baseIntensity;
        colors[i * 3 + 1] = baseIntensity;
        colors[i * 3 + 2] = baseIntensity;
      }
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    (meshRef.current.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });

  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
  }, [colors]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, nodes.length]}>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshBasicMaterial vertexColors transparent opacity={0.9} />
    </instancedMesh>
  );
}

function NetworkConnections({ 
  nodes, 
  connections,
  pulseIntensity,
  energyPulses,
}: { 
  nodes: NetworkNode[]; 
  connections: [number, number, number][];
  pulseIntensity: number;
  energyPulses: EnergyPulse[];
}) {
  const linesRef = useRef<THREE.LineSegments>(null);
  const colorsRef = useRef<Float32Array>();

  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    
    for (const [startIdx, endIdx] of connections) {
      const start = nodes[startIdx].position;
      const end = nodes[endIdx].position;
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      colors.push(1, 1, 1, 1, 1, 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    colorsRef.current = new Float32Array(colors);
    return geo;
  }, [nodes, connections]);

  useFrame((state) => {
    if (!linesRef.current || !colorsRef.current) return;
    const time = state.clock.elapsedTime;
    
    // Reality-warping rotation
    const warpAmount = Math.sin(time * 0.2) * 0.1;
    linesRef.current.rotation.y = time * 0.02 + warpAmount;
    linesRef.current.rotation.x = Math.sin(time * 0.15) * 0.02;
    
    // Update connection colors based on energy pulses
    connections.forEach(([startIdx, endIdx], i) => {
      const startPos = nodes[startIdx].position;
      const endPos = nodes[endIdx].position;
      const midPos = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5);
      
      let maxEffect = 0;
      let effectColor = new THREE.Color(1, 1, 1);
      
      for (const pulse of energyPulses) {
        const timeSincePulse = time - pulse.startTime;
        if (timeSincePulse < 0 || timeSincePulse > 3) continue;
        
        const pulseRadius = timeSincePulse * pulse.speed;
        const distFromPulse = midPos.distanceTo(pulse.origin);
        const pulseThickness = 3;
        const waveProximity = Math.abs(distFromPulse - pulseRadius);
        
        if (waveProximity < pulseThickness) {
          const effect = (1 - waveProximity / pulseThickness) * (1 - timeSincePulse / 3);
          if (effect > maxEffect) {
            maxEffect = effect;
            effectColor = pulse.color;
          }
        }
      }
      
      const baseIntensity = 0.3 + pulseIntensity * 0.1;
      const idx = i * 6;
      
      if (maxEffect > 0) {
        colorsRef.current![idx] = THREE.MathUtils.lerp(baseIntensity, effectColor.r * 2, maxEffect);
        colorsRef.current![idx + 1] = THREE.MathUtils.lerp(baseIntensity, effectColor.g * 2, maxEffect);
        colorsRef.current![idx + 2] = THREE.MathUtils.lerp(baseIntensity, effectColor.b * 2, maxEffect);
        colorsRef.current![idx + 3] = colorsRef.current![idx];
        colorsRef.current![idx + 4] = colorsRef.current![idx + 1];
        colorsRef.current![idx + 5] = colorsRef.current![idx + 2];
      } else {
        colorsRef.current![idx] = baseIntensity;
        colorsRef.current![idx + 1] = baseIntensity;
        colorsRef.current![idx + 2] = baseIntensity;
        colorsRef.current![idx + 3] = baseIntensity;
        colorsRef.current![idx + 4] = baseIntensity;
        colorsRef.current![idx + 5] = baseIntensity;
      }
    });
    
    (linesRef.current.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    
    const material = linesRef.current.material as THREE.LineBasicMaterial;
    material.opacity = 0.15 + pulseIntensity * 0.1 + Math.sin(time) * 0.03;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.15} />
    </lineSegments>
  );
}

// Energy pulse visualization rings
function EnergyPulseRings({ energyPulses }: { energyPulses: EnergyPulse[] }) {
  const ringsRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (!ringsRef.current) return;
    const time = state.clock.elapsedTime;
    
    ringsRef.current.children.forEach((ring, i) => {
      const pulse = energyPulses[i];
      if (!pulse) {
        ring.visible = false;
        return;
      }
      
      const timeSincePulse = time - pulse.startTime;
      if (timeSincePulse < 0 || timeSincePulse > 3) {
        ring.visible = false;
        return;
      }
      
      ring.visible = true;
      const radius = timeSincePulse * pulse.speed;
      ring.scale.setScalar(radius);
      ring.position.copy(pulse.origin);
      
      const material = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = (1 - timeSincePulse / 3) * 0.5;
      material.color = pulse.color;
    });
  });
  
  return (
    <group ref={ringsRef}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[0.95, 1, 64]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function ClickHandler({ 
  onPulse,
  nodes,
}: { 
  onPulse: (position: THREE.Vector3, color: THREE.Color) => void;
  nodes: NetworkNode[];
}) {
  const { camera, raycaster, pointer } = useThree();
  
  const handleClick = useCallback(() => {
    // Find intersection with network area
    raycaster.setFromCamera(pointer, camera);
    
    // Create a plane at z=0 for intersection
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectionPoint);
    
    // Find nearest node to click
    let nearestNode = nodes[0];
    let minDist = Infinity;
    
    for (const node of nodes) {
      const dist = node.position.distanceTo(intersectionPoint);
      if (dist < minDist) {
        minDist = dist;
        nearestNode = node;
      }
    }
    
    // Generate random RGB pulse color
    const colors = [
      new THREE.Color(0, 1, 1),    // Cyan
      new THREE.Color(1, 0, 1),    // Magenta
      new THREE.Color(1, 1, 0),    // Yellow
      new THREE.Color(0, 1, 0.5),  // Green-cyan
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    onPulse(nearestNode.position.clone(), color);
  }, [camera, raycaster, pointer, nodes, onPulse]);
  
  useFrame(() => {}, 0);
  
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);
  
  return null;
}

function Scene({ 
  pulseIntensity, 
  energyPulses, 
  onPulse 
}: { 
  pulseIntensity: number;
  energyPulses: EnergyPulse[];
  onPulse: (position: THREE.Vector3, color: THREE.Color) => void;
}) {
  const { nodes, connections } = useMemo(() => generateNeuralNetwork(), []);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      const time = state.clock.elapsedTime;
      // Reality-breaking rotation with subtle glitches
      groupRef.current.rotation.y = time * 0.05;
      groupRef.current.rotation.x = Math.sin(time * 0.1) * 0.05;
      
      // Occasional "reality tear" effect
      if (Math.random() < 0.001) {
        groupRef.current.position.x = (Math.random() - 0.5) * 0.5;
      } else {
        groupRef.current.position.x *= 0.95;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <NetworkNodes nodes={nodes} pulseIntensity={pulseIntensity} energyPulses={energyPulses} />
      <NetworkConnections nodes={nodes} connections={connections} pulseIntensity={pulseIntensity} energyPulses={energyPulses} />
      <EnergyPulseRings energyPulses={energyPulses} />
      <ClickHandler onPulse={onPulse} nodes={nodes} />
    </group>
  );
}

interface NeuralNetwork3DProps {
  isInView?: boolean;
}

export function NeuralNetwork3D({ isInView = false }: NeuralNetwork3DProps) {
  const [pulseIntensity, setPulseIntensity] = useState(0);
  const [energyPulses, setEnergyPulses] = useState<EnergyPulse[]>([]);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());

  const handlePulse = useCallback((position: THREE.Vector3, color: THREE.Color) => {
    const newPulse: EnergyPulse = {
      origin: position,
      startTime: clockRef.current.getElapsedTime(),
      color,
      speed: 8 + Math.random() * 4,
    };
    
    setEnergyPulses(prev => {
      const updated = [...prev, newPulse];
      // Keep only last 3 pulses
      return updated.slice(-3);
    });
  }, []);

  useEffect(() => {
    if (isInView) {
      setPulseIntensity(1);
      // Trigger initial pulse when coming into view
      handlePulse(new THREE.Vector3(0, 0, 0), new THREE.Color(0, 1, 1));
      const timeout = setTimeout(() => {
        setPulseIntensity(0);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [isInView, handlePulse]);

  // Smooth pulse decay
  useEffect(() => {
    if (pulseIntensity > 0) {
      const interval = setInterval(() => {
        setPulseIntensity((prev) => Math.max(0, prev - 0.02));
      }, 50);
      return () => clearInterval(interval);
    }
  }, [pulseIntensity]);

  // Update clock
  useEffect(() => {
    const animate = () => {
      clockRef.current.getElapsedTime();
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  return (
    <div className="w-full h-full cursor-pointer" title="Click to create energy pulses">
      <Canvas
        camera={{ position: [0, 0, 25], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
        onCreated={({ clock }) => {
          clockRef.current = clock;
        }}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />
        
        <Scene 
          pulseIntensity={pulseIntensity} 
          energyPulses={energyPulses}
          onPulse={handlePulse}
        />
        
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.3}
          maxPolarAngle={Math.PI / 2 + 0.3}
          minPolarAngle={Math.PI / 2 - 0.3}
        />
      </Canvas>
    </div>
  );
}
