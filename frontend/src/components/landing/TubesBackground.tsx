import { useEffect, useRef } from 'react';

type TubesApp = {
  destroy?: () => void;
  dispose?: () => void;
};

type TubesFactory = (
  element: HTMLCanvasElement,
  options: {
    tubes: {
      colors: string[];
      lights: {
        intensity: number;
        colors: string[];
      };
    };
  }
) => TubesApp;

const TUBES_CURSOR_URL =
  'https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js';

const palettes = {
  dark: {
    colors: ['#8b5cf6', '#ec4899', '#22c55e'],
    lights: ['#60a5fa', '#f97316', '#f43f5e', '#a3e635'],
  },
  light: {
    colors: ['#5b6cff', '#00a37a', '#ff6b6b'],
    lights: ['#7c3aed', '#2563eb', '#f59e0b', '#10b981'],
  },
} as const;

interface TubesBackgroundProps {
  theme: 'dark' | 'light';
}

export function TubesBackground({ theme }: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted = true;
    let app: TubesApp | undefined;

    const setup = async () => {
      try {
        const module = (await import(/* @vite-ignore */ TUBES_CURSOR_URL)) as {
          default?: TubesFactory;
        };
        const createTubes = module.default;
        if (!mounted || !createTubes) return;
        const palette = palettes[theme];

        app = createTubes(canvas, {
          tubes: {
            colors: [...palette.colors],
            lights: {
              intensity: theme === 'dark' ? 200 : 160,
              colors: [...palette.lights],
            },
          },
        });
      } catch (error) {
        console.error('Failed to initialize tubes background', error);
      }
    };

    void setup();

    return () => {
      mounted = false;
      app?.destroy?.();
      app?.dispose?.();
    };
  }, [theme]);

  return (
    <div
      className={`absolute inset-0 ${
        theme === 'dark' ? 'bg-black' : 'bg-white'
      }`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${
          theme === 'dark'
            ? 'opacity-70'
            : 'opacity-100 [filter:invert(1)_hue-rotate(180deg)_saturate(1.15)_brightness(1.04)]'
        }`}
      />
    </div>
  );
}
