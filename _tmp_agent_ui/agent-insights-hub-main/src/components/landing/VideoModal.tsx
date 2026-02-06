import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({ isOpen, onClose }: VideoModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, scale: 0.9, rotateX: 10 },
        { opacity: 1, scale: 1, rotateX: 0, duration: 0.4, ease: 'power3.out' }
      );
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[90vw] p-0 bg-card border-border overflow-hidden rgb-shadow">
        <div ref={contentRef} className="relative">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Video container */}
          <AspectRatio ratio={16 / 9}>
            <div className="w-full h-full bg-black flex items-center justify-center">
              {/* Placeholder video - replace with actual video URL */}
              <video
                className="w-full h-full object-cover"
                controls
                autoPlay
                poster=""
              >
                {/* Replace with your actual video source */}
                <source src="https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
          </AspectRatio>

          {/* Decorative RGB glow */}
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(var(--rgb-cyan))] via-[rgb(var(--rgb-magenta))] to-[rgb(var(--rgb-yellow))] opacity-20 blur-xl -z-10 rounded-lg" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
