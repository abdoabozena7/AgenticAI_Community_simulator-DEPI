import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Users, Activity, CreditCard, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiService } from '@/services/api';
import { useNavigate } from 'react-router-dom';

export default function AdminTab() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<{ total_simulations?: number; used_today?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, ar: string) => (language === 'ar' ? ar : en);

  useEffect(() => {
    const load = async () => {
      try {
        const [usersRes, statsRes] = await Promise.all([
          apiService.listUsers(),
          apiService.getStats(),
        ]);
        setUsers(usersRes || []);
        setStats(statsRes || null);
      } catch (err: any) {
        setError(err?.message || t('Failed to load admin stats', 'فشل تحميل بيانات الإدارة'));
      }
    };
    load();
  }, [language]);

  const totalCredits = useMemo(
    () => users.reduce((sum, u) => sum + (u?.credits || 0), 0),
    [users]
  );

  const statCards = [
    { label: t('Total Users', 'إجمالي المستخدمين'), value: users.length.toString(), icon: Users, color: 'text-cyan-400' },
    { label: t('Total Simulations', 'إجمالي المحاكاة'), value: String(stats?.total_simulations ?? 0), icon: Activity, color: 'text-green-400' },
    { label: t('Today Usage', 'الاستخدام اليوم'), value: String(stats?.used_today ?? 0), icon: TrendingUp, color: 'text-yellow-400' },
    { label: t('Credits Issued', 'الرصيد الصادر'), value: String(totalCredits), icon: CreditCard, color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-cyan-400" />
          {t('Admin Dashboard', 'لوحة الإدارة')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('Manage users and credits quickly', 'إدارة المستخدمين والرصيد بسرعة')}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="liquid-glass rounded-xl p-5"
          >
            <stat.icon className={`w-7 h-7 mb-2 ${stat.color}`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="liquid-glass rounded-2xl p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-bold">{t('Control Center', 'مركز التحكم')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('Open the full admin panel to manage users, credits, and promo codes.', 'افتح لوحة الإدارة الكاملة لإدارة المستخدمين والرصيد وأكواد الخصم.')}
          </p>
        </div>
        <Button onClick={() => navigate('/control-center')} className="liquid-glass-button">
          {t('Open Control Center', 'فتح مركز التحكم')}
        </Button>
      </div>
    </div>
  );
}
