import React, { useRef, useEffect } from 'react';

/**
 * Placeholder component for the Three.js simulation arena. This component
 * reserves space for future 3D visualisations. A ref is attached to
 * the container so that three.js or other rendering libraries can
 * mount onto it when implemented.
 */
export default function SimulationArena() {
  const containerRef = useRef(null);
  useEffect(() => {
    // Placeholder effect – actual Three.js rendering would go here
    const container = containerRef.current;
    if (container) {
      container.style.background = '#fafafa';
      container.style.border = '1px solid #eee';
    }
  }, []);
  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}
    >
      Simulation arena placeholder
    </div>
  );
}