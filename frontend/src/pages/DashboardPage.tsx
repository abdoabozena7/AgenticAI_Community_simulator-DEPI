import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Brain, TrendingUp, Users, Zap, Settings,
  LogOut, Plus, Search, Bell, User,
  CreditCard, Shield, Globe, Moon, Sun, Home,
  Scale, Sparkles, BarChart3, Clock, CheckCircle2, AlertTriangle, Target, Beaker,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RippleButton } from '@/components/ui/ripple-button';
import { RippleInput } from '@/components/ui/ripple-input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { apiService, UserMe, SimulationListItem, SimulationAnalyticsResponse, NotificationLogItem } from '@/services/api';
import HomeTab from '@/components/dashboard/HomeTab';
import SimulationDetails, { type SimulationData } from '@/components/dashboard/SimulationDetails';
import ResearchTab from '@/components/dashboard/ResearchTab';
import IdeaCourtTab from '@/components/dashboard/IdeaCourtTab';
import AdminTab from '@/components/dashboard/AdminTab';
import DeveloperLabTab from '@/components/dashboard/DeveloperLabTab';
import NotificationsPanel, { type NotificationItem } from '@/components/dashboard/NotificationsPanel';
import { getIdeaLog, type IdeaLogEntry } from '@/lib/ideaLog';

interface Simulation {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'completed' | 'draft' | 'error';
  progress: number;
  agents: number;
  successRate: number;
  createdAt: string;
  createdAtRaw?: string;
  category: string;
  summary?: string;
  canResume?: boolean;
  resumeReason?: string | null;
}

interface ResearchResult {
  search: any;
  map?: any;
  structured?: any;
  evidence_cards?: string[];
}

const CHART_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#f97316'];

const formatRelativeTime = (dateString?: string, rtl = false) => {
  if (!dateString) return '';
  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) return dateString;
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return rtl ? 'الآن' : 'just now';
  if (minutes < 60) return rtl ? `${minutes} د` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtl ? `${hours} س` : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return rtl ? `${days} يوم` : `${days} days ago`;
};

const normalizeRate = (value?: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value <= 1 ? value * 100 : value;
};

const mapLogToSimulation = (entry: IdeaLogEntry, rtl = false): Simulation => {
  const status = (entry.status || 'draft') as Simulation['status'];
  const progress = status === 'completed' ? 100 : status === 'running' || status === 'paused' ? 60 : 0;
  return {
    id: entry.simulationId || entry.id,
    name: entry.idea,
    status,
    progress,
    agents: entry.totalAgents || 0,
    successRate: normalizeRate(entry.acceptanceRate),
    createdAt: formatRelativeTime(entry.createdAt, rtl),
    createdAtRaw: entry.createdAt,
    category: entry.category || 'Idea',
    summary: entry.summary,
    canResume: status === 'paused' || status === 'error',
    resumeReason: null,
  };
};

const mapApiSimulation = (item: SimulationListItem, rtl = false): Simulation => {
  const status = item.status as Simulation['status'];
  const progress = status === 'completed' ? 100 : status === 'running' || status === 'paused' ? 60 : 0;
  return {
    id: item.simulation_id,
    name: item.idea || 'Untitled idea',
    status,
    progress,
    agents: item.total_agents ?? 0,
    successRate: normalizeRate(item.acceptance_rate),
    createdAt: formatRelativeTime(item.created_at, rtl),
    createdAtRaw: item.created_at,
    category: item.category || 'Idea',
    summary: item.summary,
    canResume: Boolean(item.can_resume),
    resumeReason: item.resume_reason ?? null,
  };
};

const mapSimulationToDetails = (sim: Simulation): SimulationData => {
  const detailStatus: SimulationData['status'] =
    sim.status === 'error' ? 'failed' : sim.status === 'paused' ? 'running' : sim.status;
  return {
    id: sim.id,
    name: sim.name,
    status: detailStatus,
    category: sim.category,
    createdAt: sim.createdAtRaw || sim.createdAt,
    acceptanceRate: sim.successRate,
    totalAgents: sim.agents,
    summary: sim.summary,
  };
};

const READ_NOTIFICATIONS_KEY = 'notificationReadIds';

const loadReadNotificationIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(READ_NOTIFICATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const saveReadNotificationIds = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { isRTL, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('home');
  const [selectedSimulation, setSelectedSimulation] = useState<SimulationData | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [researchState, setResearchState] = useState<{
    loading: boolean;
    result: ResearchResult | null;
    error?: string | null;
    query?: string;
  }>({ loading: false, result: null, error: null, query: undefined });
  const [simulationItems, setSimulationItems] = useState<SimulationListItem[]>([]);
  const [analytics, setAnalytics] = useState<SimulationAnalyticsResponse | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() => loadReadNotificationIds());
  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const me = await apiService.getMe();
        setUser(me);
      } catch {
        navigate('/?auth=login');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      setLoadingData(true);
      setDataError(null);
      try {
        const [listRes, analyticsRes] = await Promise.all([
          apiService.listSimulations(50, 0),
          apiService.getSimulationAnalytics(7),
        ]);
        setSimulationItems(listRes.items || []);
        setAnalytics(analyticsRes || null);
      } catch (err: any) {
        setDataError(err?.message || 'Failed to load dashboard data');
      } finally {
        setLoadingData(false);
      }
    };
    loadData();
  }, [user]);

  const ideaLog = useMemo(() => getIdeaLog(), [activeNav, loading, simulationItems.length]);
  const logSimulations = useMemo(
    () => ideaLog.map((entry) => mapLogToSimulation(entry, isRTL)),
    [ideaLog, isRTL]
  );
  const apiSimulations = useMemo(
    () => simulationItems.map((item) => mapApiSimulation(item, isRTL)),
    [simulationItems, isRTL]
  );
  const simulations = useMemo(() => {
    const map = new Map<string, Simulation>();
    apiSimulations.forEach((sim) => map.set(sim.id, sim));
    logSimulations.forEach((log) => {
      const existing = map.get(log.id);
      if (!existing) {
        map.set(log.id, log);
        return;
      }
      map.set(log.id, {
        ...existing,
        summary: existing.summary || log.summary,
        agents: existing.agents || log.agents,
        successRate: existing.successRate || log.successRate,
        createdAtRaw: existing.createdAtRaw || log.createdAtRaw,
        createdAt: existing.createdAtRaw ? existing.createdAt : log.createdAt,
      });
    });
    const list = Array.from(map.values());
    list.sort((a, b) => {
      const aTime = a.createdAtRaw ? Date.parse(a.createdAtRaw) : 0;
      const bTime = b.createdAtRaw ? Date.parse(b.createdAtRaw) : 0;
      return bTime - aTime;
    });
    return list;
  }, [apiSimulations, logSimulations]);
  const filteredSimulations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return simulations;
    return simulations.filter((sim) => sim.name.toLowerCase().includes(query));
  }, [searchQuery, simulations]);
  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer' || isAdmin;
  const totalSimulations = analytics?.totals.total_simulations ?? simulations.length;
  const completedSimulations = analytics?.totals.completed ?? simulations.filter((sim) => sim.status === 'completed').length;
  const totalAgents = analytics?.totals.total_agents ?? simulations.reduce((sum, sim) => sum + (sim.agents || 0), 0);
  const avgSuccessPercent = analytics
    ? Math.round((analytics.totals.avg_acceptance_rate || 0) * 100)
    : simulations.length
      ? Math.round(simulations.reduce((sum, sim) => sum + (sim.successRate || 0), 0) / simulations.length)
      : 0;
  const weekly = analytics?.weekly || [];
  const latestDay = weekly.length ? weekly[weekly.length - 1] : undefined;
  const simChangeLabel = latestDay
    ? `${latestDay.simulations} today`
    : '--';
  const agentsChangeLabel = latestDay
    ? `${latestDay.agents} today`
    : '--';
  const successChangeLabel = '7-day avg';
  const usageLabel = typeof user?.daily_tokens_limit === 'number'
    ? `${user.daily_tokens_used ?? 0}/${user.daily_tokens_limit} tokens today`
    : (user?.daily_limit ? `${user.daily_usage ?? 0}/${user.daily_limit} today` : '--');

  const stats = [
    { label: isRTL ? 'Total Simulations' : 'Total Simulations', value: String(totalSimulations), change: simChangeLabel, trend: latestDay && latestDay.simulations > 0 ? 'up' : 'neutral', icon: Brain, color: 'text-cyan-400' },
    { label: isRTL ? 'Agents Deployed' : 'Agents Deployed', value: String(totalAgents), change: agentsChangeLabel, trend: latestDay && latestDay.agents > 0 ? 'up' : 'neutral', icon: Users, color: 'text-pink-400' },
    { label: isRTL ? 'Avg Success Rate' : 'Avg Success Rate', value: `${avgSuccessPercent}%`, change: successChangeLabel, trend: 'neutral', icon: TrendingUp, color: 'text-yellow-400' },
    { label: isRTL ? 'Credits' : 'Credits', value: String(user?.credits ?? 0), change: usageLabel, trend: 'neutral', icon: Zap, color: 'text-green-400' },
  ];

  const navItems = [
    { label: isRTL ? 'الرئيسية' : 'Home', icon: Home, id: 'home' },
    { label: isRTL ? 'المحاكاة' : 'Simulations', icon: Brain, id: 'simulations' },
    { label: isRTL ? 'البحث' : 'Research', icon: Search, id: 'research' },
    { label: isRTL ? 'محكمة الأفكار' : 'Idea Court', icon: Scale, id: 'idea-court' },
    { label: isRTL ? 'التحليلات' : 'Analytics', icon: BarChart3, id: 'analytics' },
    ...(isDeveloper ? [{ label: isRTL ? 'مختبر المطور' : 'Developer Lab', icon: Beaker, id: 'developer-lab' }] : []),
    ...(isAdmin ? [{ label: isRTL ? 'الإدارة' : 'Admin', icon: Shield, id: 'admin' }] : []),
    { label: isRTL ? 'الإعدادات' : 'Settings', icon: Settings, id: 'settings' },
  ];

  const getStatusColor = (status: Simulation['status']) => {
    switch (status) {
      case 'running': return 'text-cyan-400 bg-cyan-400/10';
      case 'paused': return 'text-amber-400 bg-amber-400/10';
      case 'completed': return 'text-green-400 bg-green-400/10';
      case 'draft': return 'text-muted-foreground bg-muted';
      case 'error': return 'text-red-400 bg-red-400/10';
    }
  };

  const getStatusIcon = (status: Simulation['status']) => {
    switch (status) {
      case 'running': return <Clock className="w-3 h-3 animate-pulse" />;
      case 'paused': return <Clock className="w-3 h-3" />;
      case 'completed': return <CheckCircle2 className="w-3 h-3" />;
      case 'draft': return <Target className="w-3 h-3" />;
      case 'error': return <AlertTriangle className="w-3 h-3" />;
    }
  };

  const isContinuableStatus = (status: Simulation['status']) =>
    status === 'running' || status === 'paused' || status === 'error';

  const handleViewDetails = (sim: Simulation) => {
    setSelectedSimulation(mapSimulationToDetails(sim));
  };

  const handleContinueSimulation = (simulationId: string) => {
    navigate(`/simulate?simulation_id=${encodeURIComponent(simulationId)}`);
  };

  const handleStartResearch = async (payload: { idea: string; location?: string; category?: string }) => {
    setActiveNav('research');
    setResearchState({ loading: true, result: null, error: null, query: payload.idea });
    try {
      const res = await apiService.runResearch(payload.idea, payload.location, payload.category, language);
      setResearchState({ loading: false, result: res, error: null, query: payload.idea });
    } catch (err: any) {
      setResearchState({ loading: false, result: null, error: err?.message || 'Research failed', query: payload.idea });
    }
  };

  const handleStartSimulation = (idea: string) => {
    if (!idea.trim()) return;
    const trimmedIdea = idea.trim();
    try {
      localStorage.setItem('pendingIdea', trimmedIdea);
      localStorage.setItem('pendingAutoStart', 'true');
      localStorage.setItem('dashboardIdea', trimmedIdea);
    } catch {
      // ignore
    }
    navigate('/simulate', {
      state: {
        idea: trimmedIdea,
        autoStart: true,
        source: 'dashboard',
      },
    });
  };

  const mapAuditToNotification = (log: NotificationLogItem): NotificationItem => {
    const action = log.action || '';
    const meta = log.meta || {};
    const idea = meta.idea || meta.query || 'Simulation';
    const acceptanceRaw = typeof meta.acceptance_rate === 'number'
      ? meta.acceptance_rate
      : typeof meta.acceptance_rate === 'string'
        ? Number.parseFloat(meta.acceptance_rate)
        : null;
    const acceptanceRate = typeof acceptanceRaw === 'number' && !Number.isNaN(acceptanceRaw)
      ? Math.round(normalizeRate(acceptanceRaw))
      : null;
    let type: NotificationItem['type'] = 'info';
    let title = 'Activity';
    let message = 'You have a new update.';

    switch (action) {
      case 'simulation.completed':
        type = 'success';
        title = 'Simulation Complete';
        message = acceptanceRate !== null
          ? `${idea} finished with ${acceptanceRate}% acceptance.`
          : `${idea} finished successfully.`;
        break;
      case 'simulation.started':
        type = 'info';
        title = 'Simulation Started';
        message = `${idea} is now running.`;
        break;
      case 'promo.redeem':
        type = 'success';
        title = 'Promo Applied';
        {
          const bonus = typeof meta.bonus_attempts === 'number'
            ? meta.bonus_attempts
            : typeof meta.bonus_attempts === 'string'
              ? Number.parseFloat(meta.bonus_attempts)
              : null;
          message = bonus ? `+${bonus} credits added.` : 'Promo redeemed.';
        }
        break;
      case 'auth.login':
        type = 'info';
        title = 'Signed In';
        message = 'You signed in successfully.';
        break;
      case 'auth.register':
        type = 'info';
        title = 'Account Created';
        message = 'Your account was created.';
        break;
      case 'auth.verify_email':
        type = 'success';
        title = 'Email Verified';
        message = 'Your email has been verified.';
        break;
      default:
        break;
    }

    const id = String(log.id);
    return {
      id,
      type,
      title,
      titleAr: title,
      message,
      messageAr: message,
      time: formatRelativeTime(log.created_at, isRTL),
      read: readNotificationIds.includes(id),
    };
  };

  const loadNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const res = await apiService.listNotifications(20);
      const mapped = (res.items || []).map(mapAuditToNotification);
      setNotifications(mapped);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const handleMarkAllRead = () => {
    const ids = notifications.map((n) => n.id);
    const next = Array.from(new Set([...readNotificationIds, ...ids]));
    setReadNotificationIds(next);
    saveReadNotificationIds(next);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleMarkRead = (id: string) => {
    if (readNotificationIds.includes(id)) return;
    const next = [...readNotificationIds, id];
    setReadNotificationIds(next);
    saveReadNotificationIds(next);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const weeklyData = useMemo(() => {
    return (analytics?.weekly || []).map((entry) => {
      const date = entry.date ? new Date(entry.date) : null;
      const label = date && !Number.isNaN(date.valueOf())
        ? date.toLocaleDateString(isRTL ? 'ar' : 'en-US', { weekday: 'short' })
        : entry.date;
      return { name: label, simulations: entry.simulations, success: entry.success, agents: entry.agents };
    });
  }, [analytics, isRTL]);

  const categoryData = useMemo(() => {
    return (analytics?.categories || []).map((entry, idx) => ({
      name: entry.name,
      value: entry.value,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }));
  }, [analytics]);

  const completionRate = totalSimulations > 0
    ? Math.round((completedSimulations / totalSimulations) * 100)
    : 0;

  const handleRedeemPromo = async (code: string) => {
    const res = await apiService.redeemPromo(code);
    const me = await apiService.getMe();
    setUser(me);
    return `${res.bonus_attempts} ${isRTL ? 'رصيد تمت إضافته' : 'credits added'}`;
  };
  const handleLogout = async () => {
    await apiService.logout();
    navigate('/');
  };

  useEffect(() => {
    if (!showNotifications) return;
    loadNotifications();
  }, [showNotifications]);

  useEffect(() => {
    if (!notifications.length) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: readNotificationIds.includes(n.id) }))
    );
  }, [readNotificationIds, notifications.length]);

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{isRTL ? 'أهلاً بك' : 'Welcome back'} ًں‘‹</h1>
        <p className="text-muted-foreground mt-1">{isRTL ? 'ملخص نشاطك' : "Here's your activity summary"}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="liquid-glass border-border/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-3xl font-bold mt-2">{s.value}</p>
                  <p
                    className={cn(
                      "text-sm mt-1",
                      s.trend === 'up'
                        ? 'text-green-400'
                        : s.trend === 'down'
                          ? 'text-red-400'
                          : 'text-muted-foreground'
                    )}
                  >
                    {s.change}
                  </p>
                </div>
                <div className={cn("p-3 rounded-xl bg-white/5", s.color)}><s.icon className="w-6 h-6" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="liquid-glass border-border/50">
        <CardHeader>
          <CardTitle>{isRTL ? 'آخر المحاكاة' : 'Recent Simulations'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {simulations.length === 0 && (
              <p className="text-sm text-muted-foreground">No simulations yet.</p>
            )}
            {simulations.slice(0, 4).map((sim) => (
              <div
                key={sim.id}
                onClick={() => {
                  if (sim.status === 'completed') {
                    handleViewDetails(sim);
                  } else if (isContinuableStatus(sim.status)) {
                    handleContinueSimulation(sim.id);
                  }
                }}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl bg-white/5 transition-all group",
                  sim.status === 'completed' || isContinuableStatus(sim.status)
                    ? "hover:bg-white/10 cursor-pointer"
                    : "cursor-default"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate text-sm">{sim.name}</h3>
                    <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", getStatusColor(sim.status))}>
                      {getStatusIcon(sim.status)}{sim.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>{sim.agents} agents</span>
                    {sim.status === 'completed' && <span className="text-green-400">{sim.successRate}%</span>}
                    <span>{sim.createdAt}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSimulations = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isRTL ? 'المحاكاة' : 'Simulations'}</h1>
          <p className="text-muted-foreground text-sm">{isRTL ? 'إدارة جميع المحاكاة' : 'Manage all simulations'}</p>
        </div>
        <RippleButton className="gap-2" onClick={() => setActiveNav('home')}>
          <Plus className="w-4 h-4" />{isRTL ? 'محاكاة جديدة' : 'New Simulation'}
        </RippleButton>
      </div>
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="liquid-glass">
          <TabsTrigger value="all">{isRTL ? 'الكل' : 'All'}</TabsTrigger>
          <TabsTrigger value="running">{isRTL ? 'جارية' : 'Running'}</TabsTrigger>
          <TabsTrigger value="completed">{isRTL ? 'مكتملة' : 'Completed'}</TabsTrigger>
          <TabsTrigger value="draft">{isRTL ? 'مسودات' : 'Drafts'}</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <div className="grid gap-3">
            {filteredSimulations.length === 0 && (
              <p className="text-sm text-muted-foreground">No simulations yet.</p>
            )}
            {filteredSimulations.map((sim) => (
              <Card key={sim.id} className="liquid-glass border-border/50 hover:bg-white/5 transition-all">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                      <Brain className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{sim.name}</h3>
                        <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", getStatusColor(sim.status))}>
                          {getStatusIcon(sim.status)}{sim.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground">{sim.category}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{sim.agents} agents</span>
                        {sim.status === 'completed' && <span className="text-green-400">{sim.successRate}%</span>}
                        <span>{sim.createdAt}</span>
                      </div>
                      {(sim.status === 'running' || sim.status === 'paused') && <Progress value={sim.progress} className="mt-2 h-1.5" />}
                    </div>
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (sim.status === 'completed') {
                          handleViewDetails(sim);
                          return;
                        }
                        if (isContinuableStatus(sim.status)) {
                          handleContinueSimulation(sim.id);
                          return;
                        }
                        setActiveNav('home');
                      }}
                    >
                      {sim.status === 'completed'
                        ? (isRTL ? 'عرض التفاصيل' : 'View Details')
                        : (isRTL ? 'متابعة' : 'Continue')}
                    </RippleButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="running" className="mt-4">
          <div className="grid gap-3">
            {filteredSimulations.filter((sim) => sim.status === 'running' || sim.status === 'paused' || sim.status === 'error').length === 0 && (
              <p className="text-sm text-muted-foreground">No active simulations.</p>
            )}
            {filteredSimulations.filter((sim) => sim.status === 'running' || sim.status === 'paused' || sim.status === 'error').map((sim) => (
              <Card key={sim.id} className="liquid-glass border-border/50 hover:bg-white/5 transition-all">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                      <Brain className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{sim.name}</h3>
                        <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", getStatusColor(sim.status))}>
                          {getStatusIcon(sim.status)}{sim.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground">{sim.category}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{sim.agents} agents</span>
                        <span>{sim.createdAt}</span>
                      </div>
                      {(sim.status === 'running' || sim.status === 'paused') && <Progress value={sim.progress} className="mt-2 h-1.5" />}
                    </div>
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => handleContinueSimulation(sim.id)}
                    >
                      {isRTL ? 'متابعة' : 'Continue'}
                    </RippleButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <div className="grid gap-3">
            {filteredSimulations.filter((sim) => sim.status === 'completed').length === 0 && (
              <p className="text-sm text-muted-foreground">No completed simulations.</p>
            )}
            {filteredSimulations.filter((sim) => sim.status === 'completed').map((sim) => (
              <Card key={sim.id} className="liquid-glass border-border/50 hover:bg-white/5 transition-all">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                      <Brain className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{sim.name}</h3>
                        <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", getStatusColor(sim.status))}>
                          {getStatusIcon(sim.status)}{sim.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground">{sim.category}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{sim.agents} agents</span>
                        <span className="text-green-400">{sim.successRate}%</span>
                        <span>{sim.createdAt}</span>
                      </div>
                    </div>
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(sim)}
                    >
                      {isRTL ? 'عرض التفاصيل' : 'View Details'}
                    </RippleButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="draft" className="mt-4">
          <div className="grid gap-3">
            {filteredSimulations.filter((sim) => sim.status === 'draft').length === 0 && (
              <p className="text-sm text-muted-foreground">No drafts yet.</p>
            )}
            {filteredSimulations.filter((sim) => sim.status === 'draft').map((sim) => (
              <Card key={sim.id} className="liquid-glass border-border/50 hover:bg-white/5 transition-all">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                      <Brain className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{sim.name}</h3>
                        <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", getStatusColor(sim.status))}>
                          {getStatusIcon(sim.status)}{sim.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground">{sim.category}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{sim.createdAt}</span>
                      </div>
                    </div>
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveNav('home')}
                    >
                      {isRTL ? 'متابعة' : 'Continue'}
                    </RippleButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );

  const renderAnalytics = () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isRTL ? 'Analytics' : 'Analytics'}</h1>
        <p className="text-muted-foreground text-sm">{isRTL ? 'Detailed insights' : 'Detailed insights'}</p>
      </div>
      {dataError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          {dataError}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="liquid-glass border-border/50 lg:col-span-2">
          <CardHeader><CardTitle>{isRTL ? 'Weekly Activity' : 'Weekly Activity'}</CardTitle></CardHeader>
          <CardContent>
            {weeklyData.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="simulations" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="success" fill="#4ade80" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">
                {loadingData ? 'Loading analytics...' : 'No analytics data yet.'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="liquid-glass border-border/50">
          <CardHeader><CardTitle>{isRTL ? 'By Category' : 'By Category'}</CardTitle></CardHeader>
          <CardContent>
            {categoryData.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={5} dataKey="value">
                    {categoryData.map((e, i) => <Cell key={`cell-${i}`} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">
                {loadingData ? 'Loading categories...' : 'No category data yet.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { value: `${completionRate}%`, label: isRTL ? 'Completion Rate' : 'Completion Rate', color: 'text-cyan-400' },
          { value: String(completedSimulations), label: isRTL ? 'Completed Sims' : 'Completed Sims', color: 'text-pink-400' },
          { value: String(totalAgents), label: isRTL ? 'Total Agents' : 'Total Agents', color: 'text-yellow-400' },
        ].map(s => (
          <Card key={s.label} className="liquid-glass border-border/50">
            <CardContent className="p-5 text-center">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <p className="text-muted-foreground mt-1 text-sm">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{isRTL ? 'الإعدادات' : 'Settings'}</h1>
        <p className="text-muted-foreground text-sm">{isRTL ? 'إدارة حسابك' : 'Manage your account'}</p>
      </div>
      <Card className="liquid-glass border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" />{isRTL ? 'الملف الشخصي' : 'Profile'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-2xl font-bold text-white">
              {(user?.username || 'U').slice(0, 1).toUpperCase()}
            </div>
            <RippleButton variant="outline" size="sm">{isRTL ? 'تغيير الصورة' : 'Change Avatar'}</RippleButton>
          </div>
          <div className="grid gap-4">
            <div><Label>{isRTL ? 'الاسم' : 'Name'}</Label><RippleInput defaultValue={user?.username || 'User'} className="mt-1.5" /></div>
            <div><Label>{isRTL ? 'البريد' : 'Email'}</Label><RippleInput defaultValue={user?.username ? `${user.username}@example.com` : 'user@example.com'} className="mt-1.5" /></div>
          </div>
        </CardContent>
      </Card>
      <Card className="liquid-glass border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" />{isRTL ? 'الفوترة' : 'Billing'}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20">
            <div>
              <p className="font-semibold">Pro Plan</p>
              <p className="text-sm text-muted-foreground">$29/{isRTL ? 'شهر' : 'month'}</p>
            </div>
            <RippleButton variant="outline" size="sm">{isRTL ? 'إدارة' : 'Manage'}</RippleButton>
          </div>
        </CardContent>
      </Card>
      <Card className="liquid-glass border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />{isRTL ? 'المظهر' : 'Appearance'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              <div><p className="font-medium">{isRTL ? 'الوضع الداكن' : 'Dark Mode'}</p></div>
            </div>
            <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5" />
              <div><p className="font-medium">{isRTL ? 'اللغة' : 'Language'}</p></div>
            </div>
            <RippleButton variant="outline" size="sm" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}>
              {language === 'en' ? 'العربية' : 'English'}
            </RippleButton>
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">{isRTL ? 'إشعارات البريد' : 'Email Notifications'}</p></div>
            <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">{isRTL ? 'إشعارات المتصفح' : 'Push Notifications'}</p></div>
            <Switch checked={pushNotifications} onCheckedChange={setPushNotifications} />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderContent = () => {
    if (selectedSimulation) {
      return (
        <SimulationDetails
          simulation={selectedSimulation}
          onBack={() => setSelectedSimulation(null)}
          onRerun={(simId) => {
            const sim = simulations.find((item) => item.id === simId);
            setSelectedSimulation(null);
            if (sim?.name) {
              handleStartSimulation(sim.name);
            } else {
              setActiveNav('home');
            }
          }}
        />
      );
    }

    switch (activeNav) {
      case 'home': return (
        <HomeTab
          onStartResearch={handleStartResearch}
          onStartSimulation={handleStartSimulation}
          onRedeemPromo={handleRedeemPromo}
          researchBusy={researchState.loading}
        />
      );
      case 'research': return (
        <div className="space-y-3">
          {researchState.error && (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
              {researchState.error}
            </div>
          )}
          <ResearchTab
            loading={researchState.loading}
            result={researchState.result}
            query={researchState.query}
            onStartSimulation={() => {
              if (researchState.query) handleStartSimulation(researchState.query);
            }}
          />
        </div>
      );
      case 'idea-court': return <IdeaCourtTab />;
      case 'developer-lab': return <DeveloperLabTab />;
      case 'admin': return <AdminTab />;
      case 'simulations': return renderSimulations();
      case 'analytics': return renderAnalytics();
      case 'settings': return renderSettings();
      default: return renderOverview();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        {isRTL ? 'جارٍ تحميل لوحة التحكم...' : 'Loading dashboard...'}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        {isRTL ? 'لم يتم العثور على الجلسة.' : 'Session not found.'}
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background flex ${isRTL ? 'flex-row-reverse' : ''}`}>
      <aside className={`w-56 border-border/50 liquid-glass flex flex-col shrink-0 ${isRTL ? 'border-l' : 'border-r'}`}>
        <div className="p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-purple-500 to-yellow-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">ASSET</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveNav(item.id); setSelectedSimulation(null); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm",
                activeNav === item.id
                  ? "bg-gradient-to-r from-cyan-500/20 to-transparent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-border/50">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
              {(user.username || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.username || 'User'}</p>
              <p className="text-xs text-muted-foreground">{isAdmin ? (isRTL ? 'مسؤول' : 'Administrator') : 'Pro Plan'}</p>
            </div>
            <button onClick={handleLogout} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors" title="Logout">
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border/50 liquid-glass flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-sm">
            <div className="relative flex-1">
              <Search className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`} />
              <RippleInput
                placeholder={isRTL ? 'بحث...' : 'Search...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${isRTL ? 'pr-9' : 'pl-9'} bg-white/5 border-transparent h-9 text-sm`}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RippleButton variant="ghost" size="sm" onClick={toggleTheme} className="h-9 w-9 p-0">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </RippleButton>
            <RippleButton variant="ghost" size="sm" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} className="h-9 w-9 p-0">
              <Globe className="w-4 h-4" />
            </RippleButton>
            <div className="relative">
              <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-2 hover:bg-white/5 rounded-lg transition-colors">
                <Bell className="w-4 h-4 text-muted-foreground" />
                {unreadNotifications > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-cyan-400 rounded-full" />
                )}
              </button>
              <NotificationsPanel
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
                items={notifications}
                loading={notificationsLoading}
                onMarkAllRead={handleMarkAllRead}
                onMarkRead={handleMarkRead}
              />
            </div>
            <RippleButton onClick={() => setActiveNav('home')} size="sm" className="gap-1 h-9 text-xs">
              <Plus className="w-3.5 h-3.5" />{isRTL ? 'جديد' : 'New'}
            </RippleButton>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <motion.div key={activeNav + (selectedSimulation?.id || '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {renderContent()}
          </motion.div>
        </div>
      </main>
    </div>
  );
}





