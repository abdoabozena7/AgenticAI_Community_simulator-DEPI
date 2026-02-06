import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './LandingSimulationNetwork.css';

type AgentStatus = 'neutral' | 'accepted' | 'rejected';
type ThemeMode = 'dark' | 'light';

interface Agent {
  id: number;
  status: AgentStatus;
  position: THREE.Vector3;
  connections: number[];
  category: string;
  reasoning: string;
  group?: THREE.Group;
  mesh?: THREE.Mesh;
  glowMesh?: THREE.Mesh;
}

interface ConnectionEdge {
  from: number;
  to: number;
  line: THREE.Line;
  active: boolean;
}

interface Pulse {
  mesh: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  fromId: number;
  toId: number;
  glowMaterial: THREE.MeshBasicMaterial;
  coreMaterial: THREE.MeshBasicMaterial;
}

interface ThemeValues {
  background: number;
  neutral: number;
  pulse: number;
  connectionActive: number;
  connectionInactive: number;
}

interface PopupDiv extends HTMLDivElement {
  _swapTimer?: number | null;
}

const CONFIG = {
  agentCount: 25,
  nodeRadius: 0.15,
  glowRadius: 0.25,
  pulseCore: 0.06,
  pulseGlow: 0.15,
  networkRadiusMin: 4,
  networkRadiusMax: 5.5,
  cameraPosition: [0, 0, 12] as [number, number, number],
  cameraFOV: 60,
  accepted: 0x22c55e,
  rejected: 0xef4444,
  neutral: 0x6b7280,
  pulse: 0xffffff,
  background: 0x000000,
  connectionActive: 0xffffff,
  connectionInactive: 0x374151,
  rotationSpeed: 0.05,
  pulseSpeed: 0.02,
  simulationInterval: 1200,
  stepBatchMin: 2,
  stepBatchMax: 4,
  connectionMin: 1,
  connectionMax: 3,
};

const THEMES: Record<ThemeMode, ThemeValues> = {
  dark: {
    background: 0x000000,
    neutral: 0x6b7280,
    pulse: 0xffffff,
    connectionActive: 0xffffff,
    connectionInactive: 0x374151,
  },
  light: {
    background: 0xffffff,
    neutral: 0x111827,
    pulse: 0x111827,
    connectionActive: 0x111827,
    connectionInactive: 0xd1d5db,
  },
};

const REASONING: Record<AgentStatus, string[]> = {
  neutral: [
    'I am still evaluating this idea.',
    'I am unsure about this idea.',
    'I need more data before deciding.',
    'I am considering the risks and benefits.',
    'I am waiting for more signals.',
    'I am not convinced yet.',
  ],
  accepted: [
    'I think the idea is good.',
    'I agree.',
    'I support this direction.',
    'I am confident in this plan.',
    'I believe this will work well.',
    'I would move forward with this.',
  ],
  rejected: [
    'I refuse this idea.',
    'I disagree with this approach.',
    'I do not support this proposal.',
    'I think this is too risky.',
    'I cannot endorse this idea.',
    'I am opposed to this direction.',
  ],
};

const POPUP_CONFIG = {
  min: 1,
  max: 2,
  interval: 3000,
};

function pickRandomReasoning(status: AgentStatus): string {
  const options = REASONING[status];
  return options[Math.floor(Math.random() * options.length)] || '';
}

interface LandingSimulationNetworkProps {
  isInView?: boolean;
}

export function LandingSimulationNetwork({ isInView = false }: LandingSimulationNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const popupContainerRef = useRef<HTMLDivElement>(null);

  const [statsText, setStatsText] = useState('25 Nodes - 0 Connections');

  useEffect(() => {
    const container = containerRef.current;
    const popupContainer = popupContainerRef.current;
    if (!container || !popupContainer) return;

    let mounted = true;
    let rafId = 0;
    let simulationIntervalId = 0;
    let popupIntervalId = 0;
    let isRunning = false;

    const currentTheme: ThemeValues = { ...THEMES.dark };
    const worldPosition = new THREE.Vector3();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CONFIG.cameraFOV, 1, 0.1, 1000);
    camera.position.set(...CONFIG.cameraPosition);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(currentTheme.background, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 20;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    const greenLight = new THREE.PointLight(0x22c55e, 1, 100);
    const purpleLight = new THREE.PointLight(0x5c2b8a, 0.48, 100);
    const whiteLight = new THREE.PointLight(0xffffff, 0.3, 100);
    greenLight.position.set(10, 10, 10);
    purpleLight.position.set(-10, -10, -10);
    whiteLight.position.set(0, 10, 0);
    scene.add(ambientLight, greenLight, purpleLight, whiteLight);

    const bgGeometry = new THREE.SphereGeometry(25, 64, 64);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: currentTheme.background,
      side: THREE.BackSide,
    });
    const bgSphere = new THREE.Mesh(bgGeometry, bgMaterial);
    scene.add(bgSphere);

    const networkGroup = new THREE.Group();
    scene.add(networkGroup);

    let agents: Agent[] = [];
    let connections: ConnectionEdge[] = [];
    let pulses: Pulse[] = [];
    let popupPool: PopupDiv[] = [];

    const disposeObject = (obj: THREE.Object3D) => {
      obj.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const mat: any = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach((m: THREE.Material) => m.dispose());
        } else if (mat && typeof mat.dispose === 'function') {
          mat.dispose();
        }
      });
    };

    const clearNetworkObjects = () => {
      while (networkGroup.children.length > 0) {
        const obj = networkGroup.children[0];
        networkGroup.remove(obj);
        disposeObject(obj);
      }
    };

    const updateStats = () => {
      if (!mounted) return;
      setStatsText(`Nodes: ${agents.length} • Connections: ${connections.length}`);
    };

    const updateNodeAppearance = (agent: Agent) => {
      if (!agent.mesh || !agent.glowMesh) return;
      const color =
        agent.status === 'accepted'
          ? CONFIG.accepted
          : agent.status === 'rejected'
            ? CONFIG.rejected
            : currentTheme.neutral;

      const nodeMat = agent.mesh.material as THREE.MeshStandardMaterial;
      nodeMat.color.setHex(color);
      nodeMat.emissive.setHex(color);
      nodeMat.emissiveIntensity = agent.status === 'neutral' ? 0.1 : 0.5;

      const glowMat = agent.glowMesh.material as THREE.MeshBasicMaterial;
      glowMat.color.setHex(color);
      glowMat.opacity = agent.status === 'neutral' ? 0 : 0.2;
    };

    const generateAgents = (count: number) => {
      const categories = ['Tech', 'Finance', 'Health', 'Education', 'Consumer'];
      agents = [];
      for (let i = 0; i < count; i++) {
        const phi = Math.acos(-1 + (2 * i) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        const radius = CONFIG.networkRadiusMin + Math.random() * (CONFIG.networkRadiusMax - CONFIG.networkRadiusMin);

        agents.push({
          id: i,
          status: 'neutral',
          position: new THREE.Vector3(
            radius * Math.cos(theta) * Math.sin(phi),
            radius * Math.sin(theta) * Math.sin(phi),
            radius * Math.cos(phi)
          ),
          connections: [],
          category: categories[Math.floor(Math.random() * categories.length)] || 'Tech',
          reasoning: pickRandomReasoning('neutral'),
        });
      }

      agents.forEach((agent, idx) => {
        const minConn = Math.min(CONFIG.connectionMin, count - 1);
        const maxConn = Math.min(CONFIG.connectionMax, count - 1);
        const connectionCount = Math.floor(Math.random() * (maxConn - minConn + 1)) + minConn;
        for (let c = 0; c < connectionCount; c++) {
          const targetIdx = Math.floor(Math.random() * count);
          if (targetIdx !== idx && !agent.connections.includes(targetIdx)) {
            agent.connections.push(targetIdx);
          }
        }
      });
    };

    const createConnections = () => {
      connections = [];
      agents.forEach(agent => {
        agent.connections.forEach(targetId => {
          const target = agents[targetId];
          if (!target) return;
          const points = [agent.position, target.position];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({
            color: currentTheme.connectionInactive,
            transparent: true,
            opacity: 0.3,
          });
          const line = new THREE.Line(geometry, material);
          networkGroup.add(line);
          connections.push({
            from: agent.id,
            to: targetId,
            line,
            active: false,
          });
        });
      });
    };

    const createNodes = () => {
      clearNetworkObjects();

      agents.forEach(agent => {
        const group = new THREE.Group();
        group.position.copy(agent.position);

        const nodeGeometry = new THREE.SphereGeometry(CONFIG.nodeRadius, 28, 28);
        const nodeMaterial = new THREE.MeshStandardMaterial({
          color: currentTheme.neutral,
          emissive: currentTheme.neutral,
          emissiveIntensity: 0.1,
          metalness: 0.8,
          roughness: 0.2,
        });
        const nodeMesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        group.add(nodeMesh);

        const glowGeometry = new THREE.SphereGeometry(CONFIG.glowRadius, 18, 18);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: currentTheme.neutral,
          transparent: true,
          opacity: 0,
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        group.add(glowMesh);

        agent.group = group;
        agent.mesh = nodeMesh;
        agent.glowMesh = glowMesh;
        networkGroup.add(group);
      });

      createConnections();
      updateStats();
    };

    const createPulse = (fromAgent: Agent, toAgent: Agent): Pulse => {
      const pulseGroup = new THREE.Group();

      const glowGeometry = new THREE.SphereGeometry(CONFIG.pulseGlow, 16, 16);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: currentTheme.pulse,
        transparent: true,
        opacity: 0.35,
      });
      pulseGroup.add(new THREE.Mesh(glowGeometry, glowMaterial));

      const coreGeometry = new THREE.SphereGeometry(CONFIG.pulseCore, 16, 16);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: currentTheme.pulse,
        transparent: true,
        opacity: 0.9,
      });
      pulseGroup.add(new THREE.Mesh(coreGeometry, coreMaterial));

      pulseGroup.position.copy(fromAgent.position);
      networkGroup.add(pulseGroup);

      return {
        mesh: pulseGroup,
        from: fromAgent.position.clone(),
        to: toAgent.position.clone(),
        progress: 0,
        fromId: fromAgent.id,
        toId: toAgent.id,
        glowMaterial,
        coreMaterial,
      };
    };

    const sendPulsesFromAgent = (agent: Agent) => {
      agent.connections.forEach(targetId => {
        const target = agents[targetId];
        if (!target) return;
        pulses.push(createPulse(agent, target));
        const conn = connections.find(c => c.from === agent.id && c.to === targetId);
        if (!conn) return;
        const lineMat = conn.line.material as THREE.LineBasicMaterial;
        lineMat.color.setHex(currentTheme.connectionActive);
        lineMat.opacity = 0.9;
        conn.active = true;
      });
    };

    const updatePulses = () => {
      pulses = pulses.filter(pulse => {
        pulse.progress += CONFIG.pulseSpeed;
        if (pulse.progress >= 1) {
          networkGroup.remove(pulse.mesh);
          disposeObject(pulse.mesh);
          const conn = connections.find(c => c.from === pulse.fromId && c.to === pulse.toId);
          if (conn) {
            const lineMat = conn.line.material as THREE.LineBasicMaterial;
            lineMat.color.setHex(currentTheme.connectionInactive);
            lineMat.opacity = 0.3;
            conn.active = false;
          }
          return false;
        }

        pulse.mesh.position.lerpVectors(pulse.from, pulse.to, pulse.progress);
        const swell = 0.7 + Math.sin(pulse.progress * Math.PI) * 0.5;
        pulse.mesh.scale.setScalar(swell);
        const fade = 1 - Math.pow(pulse.progress, 1.35);
        pulse.glowMaterial.opacity = 0.45 * fade;
        pulse.coreMaterial.opacity = 0.9 * fade;
        return true;
      });
    };

    const updatePopupContent = (popup: PopupDiv, agent: Agent) => {
      const title = popup.querySelector('.landing-network-popup-title');
      const text = popup.querySelector('.landing-network-popup-text');
      if (title) title.textContent = `Node ${agent.id} - ${agent.status}`;
      if (text) text.textContent = agent.reasoning || '';
    };

    const hidePopup = (popup: PopupDiv) => {
      if (popup._swapTimer) {
        window.clearTimeout(popup._swapTimer);
        popup._swapTimer = null;
      }
      popup.classList.remove('visible');
      delete popup.dataset.agentId;
    };

    const showPopup = (popup: PopupDiv, agent: Agent) => {
      const currentId = popup.dataset.agentId;
      const targetId = String(agent.id);
      const alreadyVisible = popup.classList.contains('visible');
      if (alreadyVisible && currentId === targetId) {
        updatePopupContent(popup, agent);
        return;
      }
      if (popup._swapTimer) {
        window.clearTimeout(popup._swapTimer);
        popup._swapTimer = null;
      }
      popup.classList.remove('visible');
      popup._swapTimer = window.setTimeout(() => {
        updatePopupContent(popup, agent);
        popup.dataset.agentId = targetId;
        popup.classList.add('visible');
        popup._swapTimer = null;
      }, alreadyVisible ? 130 : 0);
    };

    const updatePopupPosition = (popup: PopupDiv, agent: Agent) => {
      if (!agent.group) return;
      agent.group.getWorldPosition(worldPosition);
      worldPosition.project(camera);
      const rect = container.getBoundingClientRect();
      const x = (worldPosition.x * 0.5 + 0.5) * rect.width;
      const y = (-worldPosition.y * 0.5 + 0.5) * rect.height;
      const popupRect = popup.getBoundingClientRect();
      const padding = 14;
      const topReserved = rect.width < 900 ? 82 : 96;
      const clampedX = Math.min(Math.max(x, padding), rect.width - popupRect.width - padding);
      const clampedY = Math.min(Math.max(y, topReserved), rect.height - popupRect.height - padding);
      popup.style.left = `${clampedX}px`;
      popup.style.top = `${clampedY}px`;
    };

    const updatePopupPositions = () => {
      popupPool.forEach(popup => {
        const id = popup.dataset.agentId;
        if (!id) return;
        const agent = agents[Number(id)];
        if (agent) updatePopupPosition(popup, agent);
      });
    };

    const refreshRandomPopups = () => {
      if (agents.length === 0) return;
      const rect = container.getBoundingClientRect();
      const compactMode = rect.width < 900;
      const minCount = Math.min(compactMode ? 1 : POPUP_CONFIG.min, agents.length);
      const maxCount = Math.min(compactMode ? 1 : POPUP_CONFIG.max, agents.length);
      const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
      const minDistance = compactMode ? 165 : 220;
      const topReserved = compactMode ? 82 : 96;

      const indices = Array.from({ length: agents.length }, (_, i) => i).sort(() => Math.random() - 0.5);
      const selectedAgents: Agent[] = [];
      const selectedPositions: Array<{ x: number; y: number }> = [];
      const selectedIds = new Set<number>();

      for (const index of indices) {
        const agent = agents[index];
        if (!agent?.group) continue;
        agent.group.getWorldPosition(worldPosition);
        worldPosition.project(camera);
        const x = (worldPosition.x * 0.5 + 0.5) * rect.width;
        const y = (-worldPosition.y * 0.5 + 0.5) * rect.height;

        if (y < topReserved || y > rect.height - 72 || x < 56 || x > rect.width - 56) continue;

        const hasClearance = selectedPositions.every(pos => {
          const dx = pos.x - x;
          const dy = pos.y - y;
          return dx * dx + dy * dy > minDistance * minDistance;
        });

        if (!hasClearance) continue;
        selectedAgents.push(agent);
        selectedPositions.push({ x, y });
        selectedIds.add(agent.id);
        if (selectedAgents.length >= count) break;
      }

      if (selectedAgents.length < count) {
        for (const index of indices) {
          const agent = agents[index];
          if (!agent || selectedIds.has(agent.id)) continue;
          selectedAgents.push(agent);
          selectedIds.add(agent.id);
          if (selectedAgents.length >= count) break;
        }
      }

      popupPool.forEach((popup, index) => {
        const agent = selectedAgents[index];
        if (agent) showPopup(popup, agent);
        else hidePopup(popup);
      });
      updatePopupPositions();
    };

    const startRandomPopups = () => {
      if (popupIntervalId) {
        window.clearInterval(popupIntervalId);
        popupIntervalId = 0;
      }
      popupContainer.innerHTML = '';
      popupPool = [];
      for (let i = 0; i < POPUP_CONFIG.max; i++) {
        const popup = document.createElement('div') as PopupDiv;
        popup.className = 'landing-network-popup';
        popup.innerHTML = `
          <div class="landing-network-popup-title"></div>
          <div class="landing-network-popup-text"></div>
        `;
        popupContainer.appendChild(popup);
        popupPool.push(popup);
      }
      refreshRandomPopups();
      popupIntervalId = window.setInterval(refreshRandomPopups, POPUP_CONFIG.interval);
    };

    const stopRandomPopups = () => {
      if (popupIntervalId) {
        window.clearInterval(popupIntervalId);
        popupIntervalId = 0;
      }
      popupPool.forEach(p => hidePopup(p));
    };

    const simulateStep = () => {
      const neutralAgents = agents.filter(a => a.status === 'neutral');
      if (neutralAgents.length === 0) {
        resetSimulation(true);
        return;
      }
      const minBatch = Math.min(CONFIG.stepBatchMin, neutralAgents.length);
      const maxBatch = Math.min(CONFIG.stepBatchMax, neutralAgents.length);
      const batchSize = Math.floor(Math.random() * (maxBatch - minBatch + 1)) + minBatch;

      const selected = new Set<number>();
      while (selected.size < batchSize) {
        selected.add(Math.floor(Math.random() * neutralAgents.length));
      }

      selected.forEach(index => {
        const agent = neutralAgents[index];
        if (!agent) return;
        agent.status = Math.random() > 0.4 ? 'accepted' : 'rejected';
        agent.reasoning = pickRandomReasoning(agent.status);
        updateNodeAppearance(agent);
        sendPulsesFromAgent(agent);
      });

      updateStats();
    };

    const startSimulation = () => {
      if (isRunning) return;
      isRunning = true;
      simulationIntervalId = window.setInterval(simulateStep, CONFIG.simulationInterval);
    };

    const stopSimulation = () => {
      isRunning = false;
      if (simulationIntervalId) {
        window.clearInterval(simulationIntervalId);
        simulationIntervalId = 0;
      }
    };

    const applyTheme = (mode: ThemeMode) => {
      const values = THEMES[mode];
      currentTheme.background = values.background;
      currentTheme.neutral = values.neutral;
      currentTheme.pulse = values.pulse;
      currentTheme.connectionActive = values.connectionActive;
      currentTheme.connectionInactive = values.connectionInactive;

      bgMaterial.color.setHex(currentTheme.background);
      renderer.setClearColor(currentTheme.background, 1);

      agents.forEach(updateNodeAppearance);
      connections.forEach(conn => {
        const lineMat = conn.line.material as THREE.LineBasicMaterial;
        lineMat.color.setHex(conn.active ? currentTheme.connectionActive : currentTheme.connectionInactive);
        lineMat.opacity = conn.active ? 0.9 : 0.3;
      });
      pulses.forEach(pulse => {
        pulse.glowMaterial.color.setHex(currentTheme.pulse);
        pulse.coreMaterial.color.setHex(currentTheme.pulse);
      });
    };

    const resetSimulation = (keepRunning = false) => {
      if (!keepRunning) {
        stopSimulation();
      }
      pulses.forEach(p => {
        networkGroup.remove(p.mesh);
        disposeObject(p.mesh);
      });
      pulses = [];
      generateAgents(CONFIG.agentCount);
      createNodes();
      startRandomPopups();
      if (keepRunning) {
        if (!isRunning) startSimulation();
      }
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updatePopupPositions();
    };

    const onVisibilityChange = () => {
      if (document.hidden && isRunning) {
        stopSimulation();
      }
    };

    const animate = () => {
      rafId = window.requestAnimationFrame(animate);
      const time = performance.now() * 0.001;

      networkGroup.rotation.y = time * CONFIG.rotationSpeed;

      agents.forEach(agent => {
        if (agent.status !== 'neutral' && agent.glowMesh) {
          const glowScale = 1 + Math.sin(time * 2) * 0.1;
          agent.glowMesh.scale.setScalar(glowScale);
        }
        if (agent.mesh) {
          agent.mesh.rotation.y += 0.01;
        }
      });

      updatePulses();
      updatePopupPositions();
      controls.update();
      renderer.render(scene, camera);
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);

    resetSimulation(false);
    applyTheme('dark');
    startSimulation();
    animate();

    return () => {
      mounted = false;

      stopSimulation();
      stopRandomPopups();
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controls.dispose();
      clearNetworkObjects();
      disposeObject(bgSphere);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="landing-network-root">
      <div ref={containerRef} className="landing-network-canvas" />

      <div className="landing-network-legend" dir="ltr">
        <div className="landing-network-legend-item">
          <div className="landing-network-legend-dot accepted" />
          Accepted
        </div>
        <div className="landing-network-legend-item">
          <div className="landing-network-legend-dot rejected" />
          Rejected
        </div>
        <div className="landing-network-legend-item">
          <div className="landing-network-legend-dot neutral" />
          Neutral
        </div>
      </div>

      <div className="landing-network-stats" dir="ltr">{statsText}</div>

      <div ref={popupContainerRef} className="landing-network-popups" aria-hidden="true" />
    </div>
  );
}


