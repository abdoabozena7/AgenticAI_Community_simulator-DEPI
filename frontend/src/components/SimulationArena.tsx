import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Agent, Connection } from '@/types/simulation';

interface AgentNodeProps {
  agent: Agent;
  onClick?: (agent: Agent) => void;
}

const AgentNode = ({ agent, onClick }: AgentNodeProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  
  const color = useMemo(() => {
    switch (agent.status) {
      case 'accepted': return '#22c55e';
      case 'rejected': return '#ef4444';
      case 'reasoning': return '#a855f7';
      default: return '#6b7280';
    }
  }, [agent.status]);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
    if (glowRef.current && agent.status !== 'neutral') {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={agent.position}>
      {/* Glow effect for non-neutral agents */}
      {agent.status !== 'neutral' && (
        <Sphere ref={glowRef} args={[0.25, 16, 16]}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.2}
          />
        </Sphere>
      )}
      
      {/* Main node */}
      <Sphere
        ref={meshRef}
        args={[0.15, 32, 32]}
        onClick={() => onClick?.(agent)}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={agent.status !== 'neutral' ? 0.5 : 0.1}
          metalness={0.8}
          roughness={0.2}
        />
      </Sphere>
    </group>
  );
};

interface ConnectionLineProps {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  pulseProgress: number;
}

const ConnectionLine = ({ from, to, active, pulseProgress }: ConnectionLineProps) => {
  const points = useMemo(() => [
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ], [from, to]);

  const pulsePosition = useMemo(() => {
    if (!active) return null;
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    return start.lerp(end, pulseProgress);
  }, [from, to, active, pulseProgress]);

  return (
    <group>
      <Line
        points={points}
        color={active ? '#ffffff' : '#9ca2ad'}
        lineWidth={active ? 2 : 0.5}
        transparent
        opacity={active ? 0.9 : 0.3}
      />
      
      {/* White light pulse traveling along the connection */}
      {pulsePosition && (
        <group position={pulsePosition}>
          {/* Glow effect */}
          <Sphere args={[0.15, 16, 16]}>
            <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
          </Sphere>
          {/* Core pulse */}
          <Sphere args={[0.06, 16, 16]}>
            <meshBasicMaterial color="#ffffff" />
          </Sphere>
        </group>
      )}
    </group>
  );
};

interface NeuralNetworkProps {
  agents: Agent[];
  activePulses: Connection[];
}

const NeuralNetwork = ({ agents, activePulses }: NeuralNetworkProps) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  const connections = useMemo(() => {
    const conns: { from: Agent; to: Agent; key: string }[] = [];
    agents.forEach(agent => {
      agent.connections.forEach(targetId => {
        const target = agents.find(a => a.id === targetId);
        if (target) {
          conns.push({ from: agent, to: target, key: `${agent.id}-${targetId}` });
        }
      });
    });
    return conns;
  }, [agents]);

  return (
    <group ref={groupRef}>
      {/* Connections */}
      {connections.map(({ from, to, key }) => {
        const pulse = activePulses.find(p => p.from === from.id && p.to === to.id);
        return (
          <ConnectionLine
            key={key}
            from={from.position}
            to={to.position}
            active={!!pulse?.active}
            pulseProgress={pulse?.pulseProgress || 0}
          />
        );
      })}
      
      {/* Agent nodes */}
      {agents.map(agent => (
        <AgentNode key={agent.id} agent={agent} />
      ))}
    </group>
  );
};

interface SimulationArenaProps {
  agents: Agent[];
  activePulses: Connection[];
}

export const SimulationArena = ({ agents, activePulses }: SimulationArenaProps) => {
  return (
    <div className="w-full h-full relative">
      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 p-3 rounded-lg bg-card/80 backdrop-blur-sm border border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
          <span className="text-xs text-muted-foreground">Accepted</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
          <span className="text-xs text-muted-foreground">Rejected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#6b7280]" />
          <span className="text-xs text-muted-foreground">Neutral</span>
        </div>
      </div>
      
      {/* Stats overlay */}
      <div className="absolute top-4 right-4 z-10 p-3 rounded-lg bg-card/80 backdrop-blur-sm border border-border">
        <div className="text-xs text-muted-foreground">
          {agents.length} Nodes | {agents.reduce((acc, a) => acc + a.connections.length, 0)} Connections
        </div>
      </div>
      
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 0, 12]} fov={60} />
        <OrbitControls 
          enablePan={false}
          minDistance={5}
          maxDistance={20}
          autoRotate={false}
        />
        
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} color="#22c55e" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#a855f7" />
        <pointLight position={[0, 10, 0]} intensity={0.3} color="#ffffff" />
        
        {/* Neural Network */}
        <NeuralNetwork agents={agents} activePulses={activePulses} />
        
        {/* Background sphere */}
        <Sphere args={[25, 64, 64]}>
          <meshBasicMaterial 
            color="#1d1d2b" 
            side={THREE.BackSide}
          />
        </Sphere>
      </Canvas>
    </div>
  );
};
