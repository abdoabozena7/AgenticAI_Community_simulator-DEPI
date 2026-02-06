import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle, AlertTriangle, Brain, Zap, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface NotificationItem {
  id: string;
  type: 'success' | 'warning' | 'info' | 'ai';
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  time: string;
  read: boolean;
}

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  items: NotificationItem[];
  loading?: boolean;
  onMarkAllRead?: () => void;
  onMarkRead?: (id: string) => void;
}

export default function NotificationsPanel({
  isOpen,
  onClose,
  items,
  loading = false,
  onMarkAllRead,
  onMarkRead,
}: NotificationsPanelProps) {
  const { isRTL } = useLanguage();
  const unreadCount = items.filter((n) => !n.read).length;

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'ai':
        return <Brain className="w-5 h-5 text-cyan-400" />;
      case 'info':
        return <Zap className="w-5 h-5 text-purple-400" />;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={`absolute ${isRTL ? 'left-0' : 'right-0'} top-full mt-2 w-96 liquid-glass rounded-2xl border border-border/50 shadow-2xl z-50 overflow-hidden`}
          >
            <div className="p-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-foreground" />
                <span className="font-bold text-foreground">
                  {isRTL ? 'الإشعارات' : 'Notifications'}
                </span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-500/20 text-cyan-400">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={onMarkAllRead} className="text-xs text-cyan-400 hover:underline">
                    {isRTL ? 'قراءة الكل' : 'Mark all read'}
                  </button>
                )}
                <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading && (
                <div className="p-6 text-xs text-muted-foreground">
                  {isRTL ? 'جارٍ تحميل الإشعارات...' : 'Loading notifications...'}
                </div>
              )}
              {!loading && items.length === 0 && (
                <div className="p-6 text-xs text-muted-foreground">
                  {isRTL ? 'لا توجد إشعارات بعد.' : 'No notifications yet.'}
                </div>
              )}
              {!loading && items.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => onMarkRead?.(notif.id)}
                  className={`p-4 border-b border-border/30 hover:bg-secondary/30 transition-colors cursor-pointer ${
                    !notif.read ? 'bg-cyan-500/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      notif.type === 'ai' ? 'bg-cyan-500/20 ai-glow-subtle' : 'bg-secondary'
                    }`}>
                      {getIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm text-foreground">
                          {isRTL ? notif.titleAr : notif.title}
                        </p>
                        {!notif.read && <span className="w-2 h-2 rounded-full bg-cyan-400" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {isRTL ? notif.messageAr : notif.message}
                      </p>
                      <span className="text-xs text-muted-foreground/60 mt-1 block">{notif.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
