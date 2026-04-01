import LiquidEther from '@/components/landing/LiquidEther';

export function LandingVisualBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-black" />

      <div className="absolute inset-0">
        <LiquidEther
          colors={['#5227FF', '#FF9FFC', '#B19EEF']}
          mouseForce={14}
          cursorSize={92}
          isViscous
          viscous={34}
          iterationsViscous={20}
          iterationsPoisson={20}
          resolution={0.35}
          isBounce={false}
          autoDemo
          autoSpeed={0.42}
          autoIntensity={1.4}
          takeoverDuration={0.25}
          autoResumeDelay={3000}
          autoRampDuration={0.6}
          color0="#5227FF"
          color1="#FF9FFC"
          color2="#B19EEF"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_80%_28%,rgba(121,86,255,0.15),transparent_46%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.28))]" />
    </div>
  );
}
