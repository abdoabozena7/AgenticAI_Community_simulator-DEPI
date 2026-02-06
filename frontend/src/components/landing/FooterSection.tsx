import { Github, Twitter, Linkedin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export function FooterSection() {
  const { t } = useLanguage();

  return (
    <footer className="relative py-16 px-6 liquid-glass border-t border-white/10">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg liquid-glass flex items-center justify-center">
              <span className="text-foreground font-bold text-sm">AS</span>
            </div>
            <span className="text-foreground font-semibold group-hover:rgb-text transition-all duration-300">ASSET</span>
          </div>

          {/* Links */}
          <nav className="flex items-center gap-8">
            {[t('nav.features'), t('pricing.tag'), t('nav.howItWorks')].map((link) => (
              <a
                key={link}
                href="#"
                className="text-sm text-muted-foreground hover:text-foreground transition-all duration-300 hover:rgb-text-subtle"
              >
                {link}
              </a>
            ))}
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            {[
              { Icon: Github, color: 'cyan' },
              { Icon: Twitter, color: 'magenta' },
              { Icon: Linkedin, color: 'yellow' },
            ].map(({ Icon, color }, i) => (
              <a
                key={i}
                href="#"
                className={`p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 rgb-icon-${color}-hover`}
              >
                <Icon className="w-5 h-5" />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {t('footer.rights')}
          </p>
          <div className="flex items-center gap-6">
            {[t('footer.privacy'), t('footer.terms')].map((link) => (
              <a
                key={link}
                href="#"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
