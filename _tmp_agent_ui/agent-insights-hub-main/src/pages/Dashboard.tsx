import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Brain, TrendingUp, Users, Zap, Settings,
  LogOut, Play, BarChart3, Target, Clock, CheckCircle2,
  AlertTriangle, ChevronRight, Plus, Search, Bell, User,
  CreditCard, Shield, Palette, Globe, Moon, Sun, Home,
  Scale, Sparkles
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

import HomeTab from '@/components/dashboard/HomeTab';
import SimulationDetails, { type SimulationData } from '@/components/dashboard/SimulationDetails';
import ResearchTab from '@/components/dashboard/ResearchTab';
import IdeaCourtTab from '@/components/dashboard/IdeaCourtTab';
import AdminTab from '@/components/dashboard/AdminTab';
import NotificationsPanel from '@/components/dashboard/NotificationsPanel';

interface Simulation {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'draft' | 'failed';
  progress: number;
  agents: number;
  successRate: number;
  createdAt: string;
  category: string;
}

const mockSimulations: Simulation[] = [
  { id: '1', name: 'E-commerce Platform MVP', status: 'completed', progress: 100, agents: 150, successRate: 78, createdAt: '2 hours ago', category: 'Tech' },
  { id: '2', name: 'SaaS Pricing Strategy', status: 'running', progress: 67, agents: 200, successRate: 0, createdAt: '30 min ago', category: 'Business' },
  { id: '3', name: 'Mobile App Concept', status: 'draft', progress: 0, agents: 0, successRate: 0, createdAt: '1 day ago', category: 'Tech' },
  { id: '4', name: 'AI Assistant Feature', status: 'completed', progress: 100, agents: 100, successRate: 23, createdAt: '3 hours ago', category: 'AI' },
  { id: '5', name: 'Subscription Box Service', status: 'completed', progress: 100, agents: 175, successRate: 82, createdAt: '1 day ago', category: 'Consumer' },
  { id: '6', name: 'B2B Lead Gen Tool', status: 'completed', progress: 100, agents: 120, successRate: 65, createdAt: '2 days ago', category: 'Business' },
];

const simulationDetailsMap: Record<string, SimulationData> = {
  '1': {
    id: '1', name: 'E-commerce Platform MVP', nameAr: 'منصة تجارة إلكترونية', category: 'Tech',
    status: 'completed', acceptanceRate: 78, totalAgents: 150, avgResponseTime: '2.3s', confidenceScore: 85,
    createdAt: '2 hours ago', location: 'Global Market', locationAr: 'السوق العالمي',
    summary: 'The e-commerce platform shows strong market potential with high acceptance among tech-savvy demographics. Focus areas for improvement include mobile UX and payment integration.',
    summaryAr: 'المنصة تظهر إمكانيات سوقية قوية مع قبول عالي بين الشباب التقنيين. مجالات التحسين تشمل تجربة الموبايل والدفع.',
    pros: [
      { text: 'Strong demand for niche e-commerce solutions', textAr: 'طلب قوي على حلول التجارة المتخصصة' },
      { text: 'Low competition in the target segment', textAr: 'منافسة منخفضة في الشريحة المستهدفة' },
      { text: 'Scalable technology stack', textAr: 'بنية تقنية قابلة للتوسع' },
      { text: 'Growing digital payment adoption', textAr: 'نمو اعتماد الدفع الرقمي' },
    ],
    cons: [
      { text: 'High initial development cost', textAr: 'تكلفة تطوير أولية عالية' },
      { text: 'Customer acquisition cost may be high', textAr: 'تكلفة اكتساب العملاء قد تكون عالية' },
      { text: 'Logistics and fulfillment challenges', textAr: 'تحديات في اللوجستيات والتوصيل' },
    ],
    suggestions: [
      { text: 'Add social commerce features for viral growth', textAr: 'أضف ميزات التجارة الاجتماعية للنمو الفيروسي', impact: 8 },
      { text: 'Implement AI-powered product recommendations', textAr: 'نفّذ توصيات منتجات بالذكاء الاصطناعي', impact: 12 },
      { text: 'Partner with local delivery services', textAr: 'تشارك مع خدمات التوصيل المحلية', impact: 6 },
      { text: 'Add loyalty program with rewards', textAr: 'أضف برنامج ولاء مع مكافآت', impact: 9 },
    ]
  },
  '4': {
    id: '4', name: 'AI Assistant Feature', nameAr: 'ميزة المساعد الذكي', category: 'AI',
    status: 'completed', acceptanceRate: 23, totalAgents: 100, avgResponseTime: '3.1s', confidenceScore: 45,
    createdAt: '3 hours ago', location: 'Tech Market', locationAr: 'السوق التقني',
    summary: 'The AI assistant concept needs significant refinement. Users expressed concerns about privacy, accuracy, and the value proposition compared to existing solutions.',
    summaryAr: 'مفهوم المساعد الذكي يحتاج تحسينات كبيرة. المستخدمون عبروا عن قلق بشأن الخصوصية والدقة والقيمة مقارنة بالحلول الموجودة.',
    pros: [
      { text: 'Growing demand for AI tools', textAr: 'طلب متزايد على أدوات الذكاء الاصطناعي' },
      { text: 'Innovative approach to problem solving', textAr: 'نهج مبتكر لحل المشاكل' },
    ],
    cons: [
      { text: 'Privacy concerns from majority of users', textAr: 'مخاوف الخصوصية من غالبية المستخدمين' },
      { text: 'Too similar to existing solutions', textAr: 'مشابه جداً للحلول الموجودة' },
      { text: 'Unclear value proposition', textAr: 'قيمة مضافة غير واضحة' },
      { text: 'High ongoing costs for AI infrastructure', textAr: 'تكاليف مستمرة عالية للبنية التحتية' },
    ],
    suggestions: [
      { text: 'Focus on a specific industry vertical', textAr: 'ركز على صناعة متخصصة معينة', impact: 15 },
      { text: 'Add strong privacy-first messaging', textAr: 'أضف رسائل قوية عن الخصوصية أولاً', impact: 12 },
      { text: 'Create unique differentiating features', textAr: 'أنشئ ميزات فريدة ومميزة', impact: 18 },
      { text: 'Offer freemium model for early adoption', textAr: 'قدم نموذج فريميوم للتبني المبكر', impact: 10 },
    ]
  },
  '5': {
    id: '5', name: 'Subscription Box Service', nameAr: 'خدمة صناديق الاشتراك', category: 'Consumer',
    status: 'completed', acceptanceRate: 82, totalAgents: 175, avgResponseTime: '1.8s', confidenceScore: 90,
    createdAt: '1 day ago', location: 'Cairo, Egypt', locationAr: 'القاهرة، مصر',
    summary: 'Excellent market reception! The subscription box service shows very high demand, especially among young professionals aged 25-35. Unique curation is the key differentiator.',
    summaryAr: 'استقبال سوقي ممتاز! خدمة صناديق الاشتراك تظهر طلب عالي جداً خاصة بين الشباب المهنيين من 25-35 سنة.',
    pros: [
      { text: 'Very high demand among target demographic', textAr: 'طلب عالي جداً بين الفئة المستهدفة' },
      { text: 'Recurring revenue model ensures stability', textAr: 'نموذج الإيرادات المتكررة يضمن الاستقرار' },
      { text: 'Low competition for curated local products', textAr: 'منافسة منخفضة للمنتجات المحلية المختارة' },
      { text: 'Strong word-of-mouth potential', textAr: 'إمكانية قوية للتسويق بالكلام' },
    ],
    cons: [
      { text: 'Supply chain management complexity', textAr: 'تعقيد إدارة سلسلة التوريد' },
      { text: 'Potential for high churn after initial excitement', textAr: 'احتمال ارتفاع الإلغاء بعد الحماس الأولي' },
    ],
    suggestions: [
      { text: 'Add personalization through surveys', textAr: 'أضف التخصيص من خلال الاستبيانات', impact: 5 },
      { text: 'Create referral program with discounts', textAr: 'أنشئ برنامج إحالة مع خصومات', impact: 7 },
      { text: 'Partner with local artisans', textAr: 'تشارك مع حرفيين محليين', impact: 4 },
      { text: 'Offer flexible subscription tiers', textAr: 'قدم مستويات اشتراك مرنة', impact: 6 },
    ]
  },
  '6': {
    id: '6', name: 'B2B Lead Gen Tool', nameAr: 'أداة جذب العملاء B2B', category: 'Business',
    status: 'completed', acceptanceRate: 65, totalAgents: 120, avgResponseTime: '2.7s', confidenceScore: 72,
    createdAt: '2 days ago', location: 'MENA Region', locationAr: 'منطقة الشرق الأوسط',
    summary: 'Moderate acceptance with room for improvement. Business users see potential but want stronger integrations and proven ROI metrics before committing.',
    summaryAr: 'قبول متوسط مع مجال للتحسين. مستخدمو الأعمال يرون إمكانيات لكن يريدون تكاملات أقوى ومقاييس عائد مثبتة.',
    pros: [
      { text: 'Clear business need in the market', textAr: 'حاجة عمل واضحة في السوق' },
      { text: 'B2B market has higher lifetime value', textAr: 'سوق B2B له قيمة عمر أعلى' },
      { text: 'Potential for enterprise contracts', textAr: 'إمكانية لعقود المؤسسات' },
    ],
    cons: [
      { text: 'Long sales cycles in B2B', textAr: 'دورات مبيعات طويلة في B2B' },
      { text: 'Need for integrations with CRMs', textAr: 'حاجة لتكامل مع أنظمة CRM' },
      { text: 'High expectations for data accuracy', textAr: 'توقعات عالية لدقة البيانات' },
    ],
    suggestions: [
      { text: 'Build CRM integrations (Salesforce, HubSpot)', textAr: 'ابنِ تكاملات CRM (Salesforce, HubSpot)', impact: 10 },
      { text: 'Add ROI calculator for prospects', textAr: 'أضف حاسبة عائد للعملاء المحتملين', impact: 8 },
      { text: 'Create case studies with early users', textAr: 'أنشئ دراسات حالة مع المستخدمين الأوائل', impact: 7 },
      { text: 'Offer free trial with full features', textAr: 'قدم تجربة مجانية بكل الميزات', impact: 9 },
    ]
  },
};

const weeklyData = [
  { name: 'Mon', simulations: 4, success: 3, agents: 400 },
  { name: 'Tue', simulations: 6, success: 5, agents: 600 },
  { name: 'Wed', simulations: 8, success: 6, agents: 800 },
  { name: 'Thu', simulations: 5, success: 4, agents: 500 },
  { name: 'Fri', simulations: 9, success: 7, agents: 900 },
  { name: 'Sat', simulations: 3, success: 2, agents: 300 },
  { name: 'Sun', simulations: 2, success: 2, agents: 200 },
];

const monthlyTrend = [
  { name: 'Jan', rate: 65 }, { name: 'Feb', rate: 68 }, { name: 'Mar', rate: 72 },
  { name: 'Apr', rate: 70 }, { name: 'May', rate: 75 }, { name: 'Jun', rate: 78 },
];

const categoryData = [
  { name: 'Tech', value: 35, color: '#22d3ee' },
  { name: 'Business', value: 25, color: '#f472b6' },
  { name: 'Consumer', value: 20, color: '#facc15' },
  { name: 'AI', value: 12, color: '#4ade80' },
  { name: 'Other', value: 8, color: '#a78bfa' },
];

const stats = [
  { label: 'Total Simulations', labelAr: 'إجمالي المحاكاة', value: '24', change: '+12%', icon: Brain, color: 'text-cyan-400' },
  { label: 'Agents Deployed', labelAr: 'الوكلاء المنشورين', value: '4.2K', change: '+8%', icon: Users, color: 'text-pink-400' },
  { label: 'Avg Success Rate', labelAr: 'متوسط النجاح', value: '72%', change: '+5%', icon: TrendingUp, color: 'text-yellow-400' },
  { label: 'Credits', labelAr: 'الرصيد', value: '1,250', change: '-15%', icon: Zap, color: 'text-green-400' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isRTL, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = (location.state as any)?.isAdmin || false;

  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('home');
  const [selectedSimulation, setSelectedSimulation] = useState<SimulationData | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);

  const navItems = [
    { label: isRTL ? 'الرئيسية' : 'Home', icon: Home, id: 'home' },
    { label: isRTL ? 'المحاكاة' : 'Simulations', icon: Brain, id: 'simulations' },
    { label: isRTL ? 'البحث' : 'Research', icon: Search, id: 'research' },
    { label: isRTL ? 'محكمة الأفكار' : 'Idea Court', icon: Scale, id: 'idea-court' },
    { label: isRTL ? 'التحليلات' : 'Analytics', icon: BarChart3, id: 'analytics' },
    ...(isAdmin ? [{ label: isRTL ? 'الإدارة' : 'Admin', icon: Shield, id: 'admin' }] : []),
    { label: isRTL ? 'الإعدادات' : 'Settings', icon: Settings, id: 'settings' },
  ];

  const getStatusColor = (status: Simulation['status']) => {
    switch (status) {
      case 'running': return 'text-cyan-400 bg-cyan-400/10';
      case 'completed': return 'text-green-400 bg-green-400/10';
      case 'draft': return 'text-muted-foreground bg-muted';
      case 'failed': return 'text-red-400 bg-red-400/10';
    }
  };

  const getStatusIcon = (status: Simulation['status']) => {
    switch (status) {
      case 'running': return <Clock className="w-3 h-3 animate-pulse" />;
      case 'completed': return <CheckCircle2 className="w-3 h-3" />;
      case 'draft': return <Target className="w-3 h-3" />;
      case 'failed': return <AlertTriangle className="w-3 h-3" />;
    }
  };

  const handleViewDetails = (simId: string) => {
    const details = simulationDetailsMap[simId];
    if (details) setSelectedSimulation(details);
  };

  const renderContent = () => {
    if (selectedSimulation) {
      return (
        <SimulationDetails
          simulation={selectedSimulation}
          onBack={() => setSelectedSimulation(null)}
          onRerun={(id) => { setSelectedSimulation(null); setActiveNav('home'); }}
        />
      );
    }

    switch (activeNav) {
      case 'home': return <HomeTab onStartResearch={() => setActiveNav('research')} />;
      case 'research': return <ResearchTab />;
      case 'idea-court': return <IdeaCourtTab />;
      case 'admin': return <AdminTab />;
      case 'simulations': return renderSimulations();
      case 'analytics': return renderAnalytics();
      case 'settings': return renderSettings();
      default: return renderOverview();
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{isRTL ? 'أهلاً بك 👋' : 'Welcome back 👋'}</h1>
        <p className="text-muted-foreground mt-1">{isRTL ? 'ملخص نشاطك' : 'Here\'s your activity summary'}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="liquid-glass border-border/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? s.labelAr : s.label}</p>
                  <p className="text-3xl font-bold mt-2">{s.value}</p>
                  <p className={cn("text-sm mt-1", s.change.startsWith('+') ? 'text-green-400' : 'text-red-400')}>{s.change}</p>
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
            {mockSimulations.slice(0, 4).map((sim) => (
              <div key={sim.id} onClick={() => sim.status === 'completed' && handleViewDetails(sim.id)}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer group">
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
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
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
            {mockSimulations.map((sim) => (
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
                      {sim.status === 'running' && <Progress value={sim.progress} className="mt-2 h-1.5" />}
                    </div>
                    <RippleButton variant="outline" size="sm" onClick={() => sim.status === 'completed' ? handleViewDetails(sim.id) : setActiveNav('home')}>
                      {sim.status === 'draft' ? (isRTL ? 'متابعة' : 'Continue') : (isRTL ? 'عرض التفاصيل' : 'View Details')}
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
        <h1 className="text-2xl font-bold">{isRTL ? 'التحليلات' : 'Analytics'}</h1>
        <p className="text-muted-foreground text-sm">{isRTL ? 'إحصائيات مفصلة' : 'Detailed insights'}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="liquid-glass border-border/50 lg:col-span-2">
          <CardHeader><CardTitle>{isRTL ? 'النشاط الأسبوعي' : 'Weekly Activity'}</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
        <Card className="liquid-glass border-border/50">
          <CardHeader><CardTitle>{isRTL ? 'حسب التصنيف' : 'By Category'}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={5} dataKey="value">
                  {categoryData.map((e, i) => <Cell key={`cell-${i}`} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { value: '89%', label: isRTL ? 'معدل الإكمال' : 'Completion Rate', color: 'text-cyan-400' },
          { value: '2.3K', label: isRTL ? 'التحليلات المولدة' : 'Insights Generated', color: 'text-pink-400' },
          { value: '15min', label: isRTL ? 'متوسط الوقت' : 'Avg. Sim Time', color: 'text-yellow-400' },
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
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-2xl font-bold text-white">J</div>
            <RippleButton variant="outline" size="sm">{isRTL ? 'تغيير الصورة' : 'Change Avatar'}</RippleButton>
          </div>
          <div className="grid gap-4">
            <div><Label>{isRTL ? 'الاسم' : 'Name'}</Label><RippleInput defaultValue={isAdmin ? 'Administrator' : 'Demo User'} className="mt-1.5" /></div>
            <div><Label>{isRTL ? 'البريد' : 'Email'}</Label><RippleInput defaultValue={isAdmin ? 'admin@system.com' : 'user@example.com'} className="mt-1.5" /></div>
          </div>
        </CardContent>
      </Card>
      <Card className="liquid-glass border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" />{isRTL ? 'المظهر' : 'Appearance'}</CardTitle></CardHeader>
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
        </CardContent>
      </Card>
      <Card className="liquid-glass border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />{isRTL ? 'الإشعارات' : 'Notifications'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="font-medium">{isRTL ? 'البريد الإلكتروني' : 'Email Notifications'}</p></div>
            <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">{isRTL ? 'إشعارات المتصفح' : 'Push Notifications'}</p></div>
            <Switch checked={pushNotifications} onCheckedChange={setPushNotifications} />
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
    </div>
  );

  return (
    <div className={`min-h-screen bg-background flex ${isRTL ? 'flex-row-reverse' : ''}`}>
      {/* Sidebar */}
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
              {isAdmin ? 'A' : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{isAdmin ? 'Admin' : 'Demo User'}</p>
              <p className="text-xs text-muted-foreground">{isAdmin ? (isRTL ? 'مسؤول' : 'Administrator') : 'Pro Plan'}</p>
            </div>
            <button onClick={() => navigate('/')} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors" title="Logout">
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
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
                <span className="absolute top-1 right-1 w-2 h-2 bg-cyan-400 rounded-full" />
              </button>
              <NotificationsPanel isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
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
