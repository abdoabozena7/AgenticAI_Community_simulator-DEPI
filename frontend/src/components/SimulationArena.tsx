import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Info, MessageSquareText, Sparkles } from 'lucide-react';
import { Agent, Connection, ReasoningMessage } from '@/types/simulation';

interface AgentNodeProps {
  agent: Agent;
  isActive: boolean;
}

const AgentNode = ({ agent, isActive }: AgentNodeProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const color = useMemo(() => {
    if (isActive || agent.status === 'reasoning' || agent.status === 'thinking') return '#f59e0b';
    if (agent.status === 'accepted' || agent.status === ('accept' as Agent['status'])) return '#22c55e';
    if (agent.status === 'rejected' || agent.status === ('reject' as Agent['status'])) return '#ef4444';
    return '#94a3b8';
  }, [agent.status, isActive]);

  useFrame((state) => {
    if (meshRef.current) meshRef.current.rotation.y += 0.01;
    if (glowRef.current && (agent.status !== 'neutral' || isActive)) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={agent.position}>
      {(agent.status !== 'neutral' || isActive) ? (
        <Sphere ref={glowRef} args={[0.34, 16, 16]}>
          <meshBasicMaterial color={color} transparent opacity={0.22} />
        </Sphere>
      ) : null}
      <Sphere ref={meshRef} args={[0.22, 32, 32]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} metalness={0.75} roughness={0.24} />
      </Sphere>
    </group>
  );
};

const ConnectionLine = ({
  from,
  to,
  active,
  pulseProgress,
}: {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  pulseProgress: number;
}) => {
  const points = useMemo(() => [new THREE.Vector3(...from), new THREE.Vector3(...to)], [from, to]);
  const pulsePosition = useMemo(
    () => (active ? new THREE.Vector3(...from).lerp(new THREE.Vector3(...to), pulseProgress) : null),
    [active, from, pulseProgress, to],
  );

  return (
    <group>
      <Line points={points} color={active ? '#ffffff' : '#64748b'} lineWidth={active ? 1.8 : 0.5} transparent opacity={active ? 0.9 : 0.28} />
      {pulsePosition ? (
        <group position={pulsePosition}>
          <Sphere args={[0.14, 16, 16]}>
            <meshBasicMaterial color="#ffffff" transparent opacity={0.25} />
          </Sphere>
          <Sphere args={[0.05, 16, 16]}>
            <meshBasicMaterial color="#ffffff" />
          </Sphere>
        </group>
      ) : null}
    </group>
  );
};

const NeuralNetwork = ({ agents, activePulses }: { agents: Agent[]; activePulses: Connection[] }) => {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.y = state.clock.elapsedTime * 0.05;
  });
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    activePulses.forEach((pulse) => {
      if (!pulse.active) return;
      ids.add(pulse.from);
      ids.add(pulse.to);
    });
    return ids;
  }, [activePulses]);
  const connections = useMemo(
    () => agents.flatMap((agent) => (
      agent.connections
        .map((targetId) => ({ key: `${agent.id}-${targetId}`, from: agent, to: byId.get(targetId) }))
        .filter((item): item is { key: string; from: Agent; to: Agent } => Boolean(item.to))
    )),
    [agents, byId],
  );
  const activeMap = useMemo(() => new Map(activePulses.map((pulse) => [`${pulse.from}-${pulse.to}`, pulse])), [activePulses]);

  return (
    <group ref={groupRef}>
      {connections.map(({ key, from, to }) => {
        const pulse = activeMap.get(key);
        return (
          <ConnectionLine
            key={key}
            from={from.position}
            to={to.position}
            active={Boolean(pulse?.active)}
            pulseProgress={pulse?.pulseProgress || 0}
          />
        );
      })}
      {agents.map((agent) => <AgentNode key={agent.id} agent={agent} isActive={activeAgentIds.has(agent.id)} />)}
    </group>
  );
};

interface SimulationArenaProps {
  agents: Agent[];
  activePulses: Connection[];
  language?: 'ar' | 'en';
  reasoningActive?: boolean;
  debateReady?: boolean;
  reasoningFeed?: ReasoningMessage[];
  graphTitle?: string;
  graphDescription?: string;
  graphLegend?: Array<{ key: string; label: string; color: string }>;
  emptyTitle?: string;
  emptyDescription?: string;
  onOpenReasoning?: () => void;
}

export const SimulationArena = ({
  agents,
  activePulses,
  language = 'en',
  reasoningActive = false,
  debateReady = false,
  reasoningFeed = [],
  graphTitle,
  graphDescription,
  graphLegend = [],
  emptyTitle,
  emptyDescription,
  onOpenReasoning,
}: SimulationArenaProps) => {
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [showMapInfo, setShowMapInfo] = useState(false);
  const cleanupGlListenersRef = useRef<(() => void) | null>(null);
  const latestReasoning = reasoningFeed.slice(-4);
  const hasNetworkData = agents.length > 0 || activePulses.length > 0 || reasoningFeed.length > 0;

  const bindGlLifecycle = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    cleanupGlListenersRef.current?.();
    setContextLost(false);
    const canvas = state.gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const handleRestored = () => setContextLost(false);
    canvas.addEventListener('webglcontextlost', handleLost, false);
    canvas.addEventListener('webglcontextrestored', handleRestored, false);
    cleanupGlListenersRef.current = () => {
      canvas.removeEventListener('webglcontextlost', handleLost, false);
      canvas.removeEventListener('webglcontextrestored', handleRestored, false);
    };
  }, []);

  useEffect(() => () => cleanupGlListenersRef.current?.(), []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-border/55 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.1),_transparent_40%),linear-gradient(180deg,rgba(9,9,11,0.88),rgba(9,9,11,0.98))]">
      <div className="absolute inset-x-4 top-4 z-10 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex max-w-xl flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => setShowMapInfo((value) => !value)}
            aria-expanded={showMapInfo}
            aria-label={language === 'ar' ? 'إظهار أو إخفاء شرح خريطة المحاكاة' : 'Toggle simulation map info'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/55 bg-card/80 text-muted-foreground backdrop-blur-xl transition hover:border-primary/35 hover:text-foreground"
          >
            <Info className="h-4 w-4" />
          </button>

          <div
            className={`w-full max-w-xl overflow-hidden rounded-[24px] border border-border/55 bg-card/80 backdrop-blur-xl transition-all duration-300 ${
              showMapInfo
                ? 'max-h-[280px] translate-y-0 opacity-100'
                : 'max-h-0 -translate-y-2 border-transparent p-0 opacity-0'
            }`}
          >
            <div className="px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                <span>{language === 'ar' ? 'خريطة المحاكاة' : 'Simulation map'}</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-foreground">
                {graphTitle || (language === 'ar' ? 'خريطة الحوار بين الوكلاء' : 'Agent discussion map')}
              </h2>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">
                {graphDescription || (language === 'ar' ? 'توضح كيف تنتقل الآراء بين الوكلاء أثناء النقاش.' : 'Shows how opinions move between agents during debate.')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm text-foreground">
                <span className="rounded-full border border-border/55 bg-background/55 px-3 py-1">
                  {language === 'ar' ? `الوكلاء ${agents.length}` : `Agents ${agents.length}`}
                </span>
                <span className="rounded-full border border-border/55 bg-background/55 px-3 py-1">
                  {language === 'ar'
                    ? `الروابط ${agents.reduce((sum, agent) => sum + agent.connections.length, 0)}`
                    : `Links ${agents.reduce((sum, agent) => sum + agent.connections.length, 0)}`}
                </span>
              </div>
              {graphLegend.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {graphLegend.map((item) => (
                    <div key={item.key} className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/45 px-3 py-1 text-xs text-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {(reasoningActive || debateReady) && onOpenReasoning ? (
          <div className="max-w-md rounded-[24px] border border-primary/25 bg-primary/12 px-4 py-3 backdrop-blur-xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{language === 'ar' ? 'نقاش مباشر' : 'Live reasoning'}</span>
            </div>
            <div className="text-sm font-semibold text-foreground">
              {language === 'ar' ? 'الوكلاء بدأوا يتناقشون الآن' : 'Agents have started discussing now'}
            </div>
            <button type="button" onClick={onOpenReasoning} className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              <MessageSquareText className="h-4 w-4" />
              <span>{language === 'ar' ? 'مشاهدة النقاش' : 'Open reasoning'}</span>
            </button>
          </div>
        ) : null}
      </div>

      {latestReasoning.length ? (
        <div className="absolute bottom-4 start-4 z-10 hidden w-[min(420px,calc(100%-2rem))] space-y-2 lg:block">
          {latestReasoning.map((message, index) => (
            <div key={message.id} className={`flex ${index % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-[22px] border px-3 py-2 text-sm backdrop-blur-xl ${index % 2 === 0 ? 'border-primary/25 bg-primary/12' : 'border-border/55 bg-card/80'}`}>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  {message.agentLabel || message.agentShortId || message.agentId}
                </div>
                <div className="line-clamp-2 text-foreground">{message.message}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hasNetworkData ? (
        <Canvas key={canvasKey} onCreated={bindGlLifecycle}>
          <PerspectiveCamera makeDefault position={[0, 0, 9]} fov={55} />
          <OrbitControls enablePan={false} minDistance={4} maxDistance={18} autoRotate={false} />
          <ambientLight intensity={0.42} />
          <pointLight position={[10, 10, 10]} intensity={1} color="#22c55e" />
          <pointLight position={[-10, -10, -10]} intensity={0.55} color="#f59e0b" />
          <pointLight position={[0, 10, 0]} intensity={0.32} color="#ffffff" />
          <NeuralNetwork agents={agents} activePulses={activePulses} />
          <Sphere args={[25, 64, 64]}>
            <meshBasicMaterial color="#05070c" side={THREE.BackSide} />
          </Sphere>
        </Canvas>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md rounded-[28px] border border-border/60 bg-card/80 p-5 text-center backdrop-blur-xl">
            <h3 className="text-lg font-semibold text-foreground">
              {emptyTitle || (language === 'ar' ? 'سيظهر ترابط الآراء هنا بعد بدء النقاش' : 'The relationship map will appear after debate starts')}
            </h3>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {emptyDescription || (language === 'ar' ? 'شغّل خط الأنابيب الإلزامي أولاً، ثم افتح النقاش لترى من يؤثر على من.' : 'Run the mandatory pipeline first, then open reasoning to see who influences whom.')}
            </p>
          </div>
        </div>
      )}

      {contextLost ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="max-w-sm rounded-[24px] border border-border bg-card/90 p-4 text-center">
            <div className="text-sm leading-7 text-foreground">
              {language === 'ar'
                ? 'فقدنا اتصال WebGL. يمكنك إعادة تشغيل العرض دون فقدان الجلسة.'
                : 'WebGL context was lost. You can restart the renderer without losing the session.'}
            </div>
            <button
              type="button"
              className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => {
                setContextLost(false);
                setCanvasKey((prev) => prev + 1);
              }}
            >
              {language === 'ar' ? 'إعادة تشغيل العرض' : 'Restart renderer'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
