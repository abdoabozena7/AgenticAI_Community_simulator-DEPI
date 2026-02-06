import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle, AlertTriangle, Brain, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface Notification {
  id: string;
  type: 'success' | 'warning' | 'info' | 'ai';
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: '1', type: 'success', title: 'Simulation Complete', titleAr: 'المحاكاة اكتملت', message: 'E-commerce Platform MVP has finished with 78% acceptance', messageAr: 'منصة التجارة الإلكترونية اكتملت بنسبة قبول 78%', time: '2 min ago', read: false },
  { id: '2', type: 'ai', title: 'AI Suggestion', titleAr: 'اقتراح الذكاء الاصطناعي', message: 'Your idea acceptance can increase by 15% with minor changes', messageAr: 'يمكن زيادة قبول فكرتك بنسبة 15% مع تعديلات بسيطة', time: '15 min ago', read: false },
  { id: '3', type: 'warning', title: 'Credits Running Low', titleAr: 'الرصيد منخفض', message: 'You have 3 credits remaining. Consider upgrading.', messageAr: 'لديك 3 محاولات متبقية. فكر في الترقية.', time: '1 hour ago', read: true },
  { id: '4', type: 'info', title: 'New Feature', titleAr: 'ميزة جديدة', message: 'Deep Research mode is now available for all plans', messageAr: 'وضع البحث العميق متاح الآن لجميع الباقات', time: '3 hours ago', read: true },
  { id: '5', type: 'success', title: 'Promo Applied', titleAr: 'تم تطبيق الخصم', message: '+5 credits have been added to your account', messageAr: 'تم إضافة +5 محاولات إلى حسابك', time: 'Yesterday', read: true },
];

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationsPanel({ isOpen, onClose }: NotificationsPanelProps) {
  const { isRTL } = useLanguage();
  const [notifications, setNotifications] = useState(mockNotifications);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'ai': return <Brain className="w-5 h-5 text-cyan-400" />;
      case 'info': return <Zap className="w-5 h-5 text-purple-400" />;
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
                  <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-500/20 text-cyan-400">{unreadCount}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-cyan-400 hover:underline">
                    {isRTL ? 'قراءة الكل' : 'Mark all read'}
                  </button>
                )}
                <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
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
