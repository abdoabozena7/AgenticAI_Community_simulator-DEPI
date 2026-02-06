import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Brain, TrendingUp, Users, Clock, Target,
  CheckCircle, XCircle, Sparkles, Send, Bot, User,
  Rocket, Lightbulb, RefreshCw, Star, ArrowRight,
  ThumbsUp, ThumbsDown, Zap, MessageCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export interface SimulationData {
  id: string;
  name: string;
  nameAr: string;
  category: string;
  status: 'running' | 'completed' | 'draft' | 'failed';
  acceptanceRate: number;
  totalAgents: number;
  avgResponseTime: string;
  confidenceScore: number;
  createdAt: string;
  location: string;
  locationAr: string;
  summary: string;
  summaryAr: string;
  pros: { text: string; textAr: string }[];
  cons: { text: string; textAr: string }[];
  suggestions: { text: string; textAr: string; impact: number }[];
}

interface ChatMsg {
  id: string;
  role: 'user' | 'ai';
  content: string;
}

const getAIResponse = (msg: string, isAbove60: boolean, isRTL: boolean): string => {
  const lowerMsg = msg.toLowerCase();

  if (isAbove60) {
    if (lowerMsg.includes('start') || lowerMsg.includes('ابدأ') || lowerMsg.includes('begin')) {
      return isRTL
        ? '🚀 خطة البداية:\n1. دراسة جدوى مالية مفصلة\n2. تحديد الموقع الأمثل\n3. إنشاء نموذج أولي\n4. اختبار مع عينة صغيرة\n5. التوسع تدريجياً\n\nأنا هنا أساعدك في كل خطوة! 💪'
        : '🚀 Here\'s your action plan:\n1. Detailed financial feasibility study\n2. Optimal location selection\n3. Create MVP/prototype\n4. Test with small sample\n5. Scale gradually\n\nI\'m here for every step! 💪';
    }
    if (lowerMsg.includes('research') || lowerMsg.includes('بحث') || lowerMsg.includes('deep')) {
      return isRTL
        ? '🔍 بناءً على البحث العميق:\n- السوق المستهدف في نمو بنسبة 23% سنوياً\n- 3 منافسين رئيسيين في المنطقة\n- متوسط هامش الربح 35-45%\n- أفضل وقت للإطلاق: خلال 3 أشهر\n\nعايز أبحث أكتر عن حاجة معينة؟ 🎯'
        : '🔍 Based on deep research:\n- Target market growing 23% annually\n- 3 main competitors in the area\n- Average profit margin 35-45%\n- Best launch window: within 3 months\n\nWant me to dig deeper into anything? 🎯';
    }
    return isRTL
      ? '✨ فكرتك قوية! نسبة القبول عالية وده معناه إن الناس فعلاً محتاجة اللي بتقدمه. اسألني عن أي حاجة - خطة البداية، البحث العميق، أو استراتيجية التسويق! 🎯'
      : '✨ Your idea is strong! The high acceptance means people genuinely need what you\'re offering. Ask me about anything - launch plan, deep research, or marketing strategy! 🎯';
  } else {
    if (lowerMsg.includes('improve') || lowerMsg.includes('حسن') || lowerMsg.includes('better')) {
      return isRTL
        ? '💡 اقتراحات التحسين:\n1. ركز على نقطة بيع فريدة (USP)\n2. عدّل التسعير ليكون أكثر تنافسية\n3. أضف خدمة ما بعد البيع\n4. استهدف شريحة أصغر وأكثر تحديداً\n\nعايز نجرب المحاكاة تاني بالتعديلات دي؟ 🔄'
        : '💡 Improvement suggestions:\n1. Focus on a unique selling point (USP)\n2. Adjust pricing to be more competitive\n3. Add after-sales service\n4. Target a smaller, more specific segment\n\nWant to re-run the simulation with these changes? 🔄';
    }
    if (lowerMsg.includes('why') || lowerMsg.includes('ليه') || lowerMsg.includes('reason')) {
      return isRTL
        ? '🤔 الأسباب الرئيسية لانخفاض نسبة القبول:\n- المنافسة العالية في المنطقة\n- التسعير مش مناسب للسوق المستهدف\n- محتاج تميز أكتر في المنتج\n\nبس متقلقش! كل فكرة ناجحة بدأت بتحسينات. خلينا نشتغل عليها سوا! 💪'
        : '🤔 Main reasons for lower acceptance:\n- High competition in the area\n- Pricing doesn\'t match target market\n- Need more product differentiation\n\nBut don\'t worry! Every successful idea started with improvements. Let\'s work on it together! 💪';
    }
    return isRTL
      ? '💪 مفيش فكرة وحشة، فيه بس فكرة محتاجة تعديل! خليني أساعدك تفهم إيه اللي ممكن نحسنه. اسألني "إزاي أحسن الفكرة؟" أو "إيه الأسباب؟" وهنشتغل عليها سوا! 🎯'
      : '💪 There are no bad ideas, just ideas that need refinement! Let me help you understand what we can improve. Ask me "how to improve?" or "why?" and we\'ll work on it together! 🎯';
  }
};

interface SimulationDetailsProps {
  simulation: SimulationData;
  onBack: () => void;
  onRerun: (simId: string) => void;
}

export default function SimulationDetails({ simulation, onBack, onRerun }: SimulationDetailsProps) {
  const { isRTL } = useLanguage();
  const isAbove60 = simulation.acceptanceRate >= 60;
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');

    setTimeout(() => {
      const aiMsg: ChatMsg = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: getAIResponse(chatInput, isAbove60, isRTL)
      };
      setChatMessages(prev => [...prev, aiMsg]);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isRTL ? simulation.nameAr : simulation.name}</h1>
          <p className="text-muted-foreground text-sm">{isRTL ? simulation.locationAr : simulation.location} • {simulation.category}</p>
        </div>
      </div>

      {/* Summary Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`liquid-glass rounded-2xl p-6 ${isAbove60 ? 'ai-glow-card-success' : 'ai-glow-card-warning'}`}
      >
        <p className="text-muted-foreground">{isRTL ? simulation.summaryAr : simulation.summary}</p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: isRTL ? 'نسبة القبول' : 'Acceptance', value: `${simulation.acceptanceRate}%`, icon: Target, color: isAbove60 ? 'text-green-400' : 'text-yellow-400', glow: true },
          { label: isRTL ? 'إجمالي الوكلاء' : 'Total Agents', value: simulation.totalAgents.toString(), icon: Users, color: 'text-cyan-400' },
          { label: isRTL ? 'متوسط الاستجابة' : 'Avg Response', value: simulation.avgResponseTime, icon: Clock, color: 'text-purple-400' },
          { label: isRTL ? 'درجة الثقة' : 'Confidence', value: `${simulation.confidenceScore}%`, icon: TrendingUp, color: 'text-blue-400' },
        ].map((stat) => (
          <Card key={stat.label} className={`liquid-glass border-border/50 ${stat.glow ? 'ai-glow-subtle' : ''}`}>
            <CardContent className="p-4">
              <stat.icon className={`w-6 h-6 mb-2 ${stat.color}`} />
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Acceptance Progress */}
      <div className="liquid-glass rounded-2xl p-6">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-muted-foreground">{isRTL ? 'نسبة القبول' : 'Acceptance Rate'}</span>
          <span className={`text-sm font-bold ${isAbove60 ? 'text-green-400' : 'text-yellow-400'}`}>
            {simulation.acceptanceRate}%
          </span>
        </div>
        <Progress value={simulation.acceptanceRate} className="h-3" />
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>0%</span>
          <span className="text-yellow-400">60%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Pros & Cons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="liquid-glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <ThumbsUp className="w-5 h-5 text-green-400" />
            {isRTL ? 'نقاط القوة' : 'Strengths'}
          </h3>
          <ul className="space-y-3">
            {simulation.pros.map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                {isRTL ? p.textAr : p.text}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="liquid-glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <ThumbsDown className="w-5 h-5 text-red-400" />
            {isRTL ? 'نقاط الضعف' : 'Weaknesses'}
          </h3>
          <ul className="space-y-3">
            {simulation.cons.map((c, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                {isRTL ? c.textAr : c.text}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      {/* Conditional Section based on acceptance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className={`liquid-glass rounded-2xl p-8 text-center ${isAbove60 ? 'ai-glow-card-success' : 'ai-glow-card-warning'}`}
      >
        <div className={`inline-flex p-4 rounded-full mb-4 ${isAbove60 ? 'bg-green-500/20' : 'bg-yellow-500/20'} ai-glow-subtle`}>
          {isAbove60 ? (
            <Rocket className="w-10 h-10 text-green-400" />
          ) : (
            <Lightbulb className="w-10 h-10 text-yellow-400" />
          )}
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {isAbove60
            ? (isRTL ? '🎉 خلينا نحول فكرتك لحقيقة!' : '🎉 Let\'s bring your idea to real life!')
            : (isRTL ? '💪 خلينا نخلي فكرتك مقبولة!' : '💪 Let\'s make your idea acceptable!')}
        </h2>
        <p className="text-muted-foreground mb-6">
          {isAbove60
            ? (isRTL ? 'نسبة القبول عالية! الناس فعلاً محتاجة فكرتك. اسألني عن خطة البداية.' : 'High acceptance! People genuinely need your idea. Ask me about a launch plan.')
            : (isRTL ? 'بتعديلات بسيطة ممكن نرفع نسبة القبول. خليني أساعدك!' : 'With small tweaks we can raise acceptance. Let me help!')}
        </p>

        {!showChat && (
          <Button onClick={() => setShowChat(true)} className="ai-glow-button liquid-glass-button py-6 px-8 text-lg">
            <MessageCircle className="w-5 h-5 mr-2" />
            {isAbove60
              ? (isRTL ? 'تكلم مع المساعد الذكي' : 'Chat with AI Assistant')
              : (isRTL ? 'اسأل عن التحسينات' : 'Ask about improvements')}
          </Button>
        )}
      </motion.div>

      {/* Suggestion Cards (> 60%) */}
      {isAbove60 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {simulation.suggestions.slice(0, 4).map((sug, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="liquid-glass rounded-xl p-5 hover:bg-white/5 transition-all cursor-pointer ai-glow-subtle group"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <Star className="w-5 h-5 text-green-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{isRTL ? sug.textAr : sug.text}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-green-400">+{sug.impact}% {isRTL ? 'تأثير' : 'impact'}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Improvement Cards (< 60%) */}
      {!isAbove60 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {simulation.suggestions.map((sug, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="liquid-glass rounded-xl p-5 hover:bg-white/5 transition-all cursor-pointer group"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/20">
                  <Lightbulb className="w-5 h-5 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{isRTL ? sug.textAr : sug.text}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-yellow-400">+{sug.impact}% {isRTL ? 'تحسين متوقع' : 'expected improvement'}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* AI Chat */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="liquid-glass rounded-2xl overflow-hidden ai-glow-card"
          >
            <div className="p-4 border-b border-border/50 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/20 ai-glow-subtle">
                <Bot className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">
                  {isRTL ? 'المساعد الذكي' : 'AI Assistant'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isRTL ? 'هنا عشان أساعدك - اسألني أي حاجة!' : 'Here to help - ask me anything!'}
                </p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="w-10 h-10 mx-auto text-cyan-400/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {isAbove60
                      ? (isRTL ? 'اسألني عن خطة البداية أو البحث العميق!' : 'Ask me about your launch plan or deep research!')
                      : (isRTL ? 'اسألني إزاي تحسن فكرتك!' : 'Ask me how to improve your idea!')}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {(isAbove60
                      ? [
                          { text: isRTL ? 'إزاي أبدأ؟' : 'How do I start?', key: 'start' },
                          { text: isRTL ? 'بحث عميق' : 'Deep research', key: 'research' },
                        ]
                      : [
                          { text: isRTL ? 'إزاي أحسن؟' : 'How to improve?', key: 'improve' },
                          { text: isRTL ? 'ليه النسبة منخفضة؟' : 'Why is it low?', key: 'why' },
                        ]
                    ).map((q) => (
                      <Button
                        key={q.key}
                        variant="outline"
                        size="sm"
                        className="rounded-full text-xs"
                        onClick={() => {
                          setChatInput(q.text);
                          setTimeout(() => {
                            const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: q.text };
                            setChatMessages(prev => [...prev, userMsg]);
                            setTimeout(() => {
                              const aiMsg: ChatMsg = {
                                id: (Date.now() + 1).toString(),
                                role: 'ai',
                                content: getAIResponse(q.text, isAbove60, isRTL)
                              };
                              setChatMessages(prev => [...prev, aiMsg]);
                            }, 1000);
                          }, 100);
                          setChatInput('');
                        }}
                      >
                        {q.text}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex gap-3",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === 'ai' && (
                    <div className="p-2 rounded-full bg-cyan-500/20 h-fit ai-glow-subtle">
                      <Bot className="w-4 h-4 text-cyan-400" />
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm whitespace-pre-wrap",
                    msg.role === 'user'
                      ? "bg-foreground text-background rounded-br-sm"
                      : "liquid-glass rounded-bl-sm"
                  )}>
                    {msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div className="p-2 rounded-full bg-foreground/10 h-fit">
                      <User className="w-4 h-4 text-foreground" />
                    </div>
                  )}
                </motion.div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-border/50 flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isRTL ? 'اكتب رسالتك...' : 'Type your message...'}
                className="flex-1 bg-secondary/50 border-border/50"
              />
              <Button onClick={handleSendMessage} disabled={!chatInput.trim()} size="icon" className="ai-glow-button">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-run Simulation Prompt */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="liquid-glass rounded-2xl p-6 text-center ai-glow-subtle"
      >
        <RefreshCw className="w-8 h-8 mx-auto text-cyan-400 mb-3" />
        <h3 className="text-lg font-bold text-foreground mb-2">
          {isRTL ? 'عايز تجرب محاكاة جديدة بالتحديثات دي؟' : 'Want to run a new simulation with these updates?'}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {isRTL
            ? `🎯 نسبة القبول ممكن ترتفع بـ 13%! أقترح تديها فرصة تانية`
            : `🎯 Your acceptance could rise by 13%! I suggest giving it another chance`}
        </p>
        <Button onClick={() => onRerun(simulation.id)} className="ai-glow-button liquid-glass-button px-8 py-5 text-base">
          <RefreshCw className="w-4 h-4 mr-2" />
          {isRTL ? 'إعادة المحاكاة' : 'Re-run Simulation'}
        </Button>
      </motion.div>
    </div>
  );
}
