import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Play, RotateCcw, Pause } from 'lucide-react';
import { RippleButton } from '@/components/ui/ripple-button';

interface Agent {
  id: number;
  status: 'neutral' | 'accepted' | 'rejected';
  position: THREE.Vector3;
  connections: number[];
  mesh?: THREE.Mesh;
  glowMesh?: THREE.Mesh;
}

interface Pulse {
  id: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  fromId: number;
  toId: number;
}

const CONFIG = {
  agentCount: 25,
  nodeRadius: 0.18,
  glowRadius: 0.3,
  pulseCore: 0.06,
  pulseGlow: 0.15,
  networkRadiusMin: 4,
  networkRadiusMax: 5.5,
  colors: {
    accepted: 0x22c55e,
    rejected: 0xef4444,
    neutral: 0x6b7280,
    pulse: 0xffffff,
    background: 0x0a0a1a,
    connectionActive: 0xffffff,
    connectionInactive: 0x374151
  },
  rotationSpeed: 0.05,
  pulseSpeed: 0.02
};

function generateAgents(count: number): Agent[] {
  const agents: Agent[] = [];
  
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(-1 + (2 * i) / count);
    const theta = Math.sqrt(count * Math.PI) * phi;
    const radius = CONFIG.networkRadiusMin + Math.random() * 
                  (CONFIG.networkRadiusMax - CONFIG.networkRadiusMin);
    
    agents.push({
      id: i,
      status: 'neutral',
      position: new THREE.Vector3(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      ),
      connections: [],
    });
  }

  // Create random connections
  agents.forEach((agent, idx) => {
    const connectionCount = Math.floor(Math.random() * 3) + 1;
    for (let c = 0; c < connectionCount; c++) {
      const targetIdx = Math.floor(Math.random() * count);
      if (targetIdx !== idx && !agent.connections.includes(targetIdx)) {
        agent.connections.push(targetIdx);
      }
    }
  });

  return agents;
}

function NetworkNodes({ agents }: { agents: Agent[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const timeRef = useRef(0);

  useFrame((state) => {
    if (!meshRef.current) return;
    timeRef.current = state.clock.elapsedTime;

    agents.forEach((agent, i) => {
      dummy.position.copy(agent.position);
      const scale = agent.status !== 'neutral' 
        ? 1 + Math.sin(timeRef.current * 3) * 0.15 
        : 1;
      dummy.scale.setScalar(CONFIG.nodeRadius * scale * 6);
      dummy.rotation.y = timeRef.current * 0.5;
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      const color = agent.status === 'accepted' ? CONFIG.colors.accepted :
                    agent.status === 'rejected' ? CONFIG.colors.rejected :
                    CONFIG.colors.neutral;
      meshRef.current!.setColorAt(i, new THREE.Color(color));
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, agents.length]}>
      <sphereGeometry args={[0.15, 32, 32]} />
      <meshStandardMaterial 
        metalness={0.9} 
        roughness={0.1}
        emissiveIntensity={0.5}
      />
    </instancedMesh>
  );
}

function NodeGlows({ agents }: { agents: Agent[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const timeRef = useRef(0);

  useFrame((state) => {
    if (!meshRef.current) return;
    timeRef.current = state.clock.elapsedTime;

    agents.forEach((agent, i) => {
      dummy.position.copy(agent.position);
      const visible = agent.status !== 'neutral';
      const scale = visible 
        ? CONFIG.glowRadius * (1 + Math.sin(timeRef.current * 3) * 0.2) * 6
        : 0.001;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      const color = agent.status === 'accepted' ? CONFIG.colors.accepted :
                    agent.status === 'rejected' ? CONFIG.colors.rejected :
                    CONFIG.colors.neutral;
      meshRef.current!.setColorAt(i, new THREE.Color(color));
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, agents.length]}>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshBasicMaterial transparent opacity={0.25} />
    </instancedMesh>
  );
}

function Connections({ agents, activeConnections }: { agents: Agent[]; activeConnections: Set<string> }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    
    agents.forEach(agent => {
      agent.connections.forEach(targetId => {
        const target = agents[targetId];
        if (target) {
          positions.push(
            agent.position.x, agent.position.y, agent.position.z,
            target.position.x, target.position.y, target.position.z
          );
        }
      });
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [agents]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial 
        color={CONFIG.colors.connectionInactive} 
        transparent 
        opacity={0.3} 
      />
    </lineSegments>
  );
}

function Pulses({ pulses }: { pulses: Pulse[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!meshRef.current) return;

    pulses.forEach((pulse, i) => {
      const pos = new THREE.Vector3().lerpVectors(pulse.from, pulse.to, pulse.progress);
      dummy.position.copy(pos);
      dummy.scale.setScalar(0.08);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (pulses.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(pulses.length, 1)]}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color={CONFIG.colors.pulse} />
    </instancedMesh>
  );
}

function Scene({ 
  agents, 
  pulses, 
  activeConnections
}: { 
  agents: Agent[]; 
  pulses: Pulse[];
  activeConnections: Set<string>;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * CONFIG.rotationSpeed;
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} color={0x22c55e} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color={0xa855f7} />
      <pointLight position={[0, 10, 0]} intensity={0.4} color={0xffffff} />
      <pointLight position={[0, -10, 0]} intensity={0.3} color={0x00ffff} />

      <group ref={groupRef}>
        <NetworkNodes agents={agents} />
        <NodeGlows agents={agents} />
        <Connections agents={agents} activeConnections={activeConnections} />
        <Pulses pulses={pulses} />
      </group>

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={20}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  );
}

interface Simulation3DProps {
  className?: string;
}

export function Simulation3D({ className }: Simulation3DProps) {
  const [agents, setAgents] = useState<Agent[]>(() => generateAgents(CONFIG.agentCount));
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activeConnections, setActiveConnections] = useState<Set<string>>(new Set());
  const [isSimulating, setIsSimulating] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const connectionCount = useMemo(() => 
    agents.reduce((acc, a) => acc + a.connections.length, 0), 
    [agents]
  );

  const counts = useMemo(() => ({
    accepted: agents.filter(a => a.status === 'accepted').length,
    rejected: agents.filter(a => a.status === 'rejected').length,
    neutral: agents.filter(a => a.status === 'neutral').length,
  }), [agents]);

  const simulateStep = useCallback(() => {
    setAgents(prevAgents => {
      const neutralAgents = prevAgents.filter(a => a.status === 'neutral');
      if (neutralAgents.length === 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setIsSimulating(false);
        return prevAgents;
      }

      const agent = neutralAgents[Math.floor(Math.random() * neutralAgents.length)];
      const newStatus = Math.random() > 0.4 ? 'accepted' : 'rejected';

      // Create pulses
      const newPulses: Pulse[] = agent.connections.map(targetId => ({
        id: `${agent.id}-${targetId}-${Date.now()}`,
        from: agent.position.clone(),
        to: prevAgents[targetId].position.clone(),
        progress: 0,
        fromId: agent.id,
        toId: targetId,
      }));
      
      setPulses(prev => [...prev, ...newPulses]);

      return prevAgents.map(a => 
        a.id === agent.id ? { ...a, status: newStatus } : a
      );
    });
  }, []);

  const startSimulation = useCallback(() => {
    if (isSimulating) return;
    setIsSimulating(true);
    intervalRef.current = setInterval(simulateStep, 1500);
  }, [isSimulating, simulateStep]);

  const stopSimulation = useCallback(() => {
    setIsSimulating(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resetSimulation = useCallback(() => {
    stopSimulation();
    setPulses([]);
    setAgents(generateAgents(CONFIG.agentCount));
  }, [stopSimulation]);

  // Animation controller for pulse updates
  const AnimationController = useCallback(() => {
    useFrame(() => {
      setPulses(prev => 
        prev
          .map(p => ({ ...p, progress: p.progress + CONFIG.pulseSpeed }))
          .filter(p => p.progress < 1)
      );
    });
    return null;
  }, []);

  return (
    <div className={`relative ${className}`}>
      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 flex gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full liquid-glass">
          <span className="w-3 h-3 rounded-full bg-success" />
          <span className="text-xs text-muted-foreground">Accepted</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full liquid-glass">
          <span className="w-3 h-3 rounded-full bg-destructive" />
          <span className="text-xs text-muted-foreground">Rejected</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full liquid-glass">
          <span className="w-3 h-3 rounded-full bg-muted-foreground" />
          <span className="text-xs text-muted-foreground">Neutral</span>
        </div>
      </div>

      {/* Stats */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
        <div className="px-4 py-2 rounded-full liquid-glass">
          <span className="text-sm text-muted-foreground font-mono">
            {agents.length} Nodes • {connectionCount} Connections
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        <RippleButton
          onClick={isSimulating ? stopSimulation : startSimulation}
          rippleColor="rgba(0, 255, 255, 0.3)"
          className="gap-2 liquid-glass-button"
        >
          {isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {isSimulating ? 'Pause' : 'Start Simulation'}
        </RippleButton>
        <RippleButton
          onClick={resetSimulation}
          variant="outline"
          rippleColor="rgba(255, 0, 255, 0.2)"
          className="gap-2 liquid-glass-button"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </RippleButton>
      </div>

      {/* Canvas */}
      <Canvas
        camera={{ position: [0, 0, 12], fov: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
        style={{ background: 'linear-gradient(180deg, #0a0a1a 0%, #050510 100%)' }}
      >
        <AnimationController />
        <Scene 
          agents={agents} 
          pulses={pulses} 
          activeConnections={activeConnections}
        />
      </Canvas>
    </div>
  );
}
