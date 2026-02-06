 import { useState, useEffect } from 'react';
 import { useNavigate } from 'react-router-dom';
 import { motion, AnimatePresence } from 'framer-motion';
 import { 
   Search, Globe, FileText, CreditCard, MapPin, CheckCircle,
   Loader2, ExternalLink, ArrowRight, Coffee, Building, Users,
   Pill, ChevronRight, Play
 } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Badge } from '@/components/ui/badge';
 import { Skeleton } from '@/components/ui/skeleton';
 import { useLanguage } from '@/contexts/LanguageContext';
 
 interface TimelineStep {
   id: number;
   icon: typeof Search;
   title: string;
   titleAr: string;
   status: 'pending' | 'running' | 'done';
 }
 
 interface Evidence {
   id: string;
   text: string;
   textAr: string;
 }
 
 interface Source {
   title: string;
   url: string;
 }
 
 const initialSteps: TimelineStep[] = [
   { id: 1, icon: Search, title: 'Searching about "Coffee Kiosk" in "Nasr City"', titleAr: 'البحث عن "كشك قهوة" في "مدينة نصر"', status: 'pending' },
   { id: 2, icon: Globe, title: 'Found 12 websites; opening top 3', titleAr: 'تم إيجاد 12 موقع؛ فتح أفضل 3', status: 'pending' },
   { id: 3, icon: FileText, title: 'Extracting content (Reader View)', titleAr: 'استخراج المحتوى (وضع القراءة)', status: 'pending' },
   { id: 4, icon: CreditCard, title: 'Creating evidence cards', titleAr: 'إنشاء بطاقات الأدلة', status: 'pending' },
   { id: 5, icon: MapPin, title: 'Map analysis (location found)', titleAr: 'تحليل الخريطة (تم إيجاد الموقع)', status: 'pending' },
   { id: 6, icon: CheckCircle, title: 'Research complete → Starting simulation...', titleAr: 'اكتمل البحث ← بدء المحاكاة...', status: 'pending' },
 ];
 
 const evidenceCards: Evidence[] = [
   { id: 'E1', text: 'High foot traffic areas boost conversions', textAr: 'المناطق ذات الحركة العالية تزيد التحويلات' },
   { id: 'E2', text: 'Competitors within 500m increase CAC', textAr: 'المنافسون في نطاق 500م يزيدون تكلفة الاستحواذ' },
   { id: 'E3', text: 'Rent range in area is 8,000-15,000 EGP', textAr: 'نطاق الإيجار في المنطقة 8,000-15,000 جنيه' },
   { id: 'E4', text: 'University presence increases coffee demand', textAr: 'وجود الجامعات يزيد الطلب على القهوة' },
 ];
 
 const sources: Source[] = [
   { title: 'Market Analysis Report 2024', url: 'https://example.com/market' },
   { title: 'Local Business Directory', url: 'https://example.com/directory' },
   { title: 'Cairo Real Estate Guide', url: 'https://example.com/realestate' },
 ];
 
 const readerContent = {
   title: 'Coffee Shop Market Analysis - Nasr City',
   url: 'https://example.com/market-analysis',
   content: `The coffee shop market in Nasr City has seen significant growth over the past 5 years. With a large student population from nearby universities, there is consistent demand for quick-service coffee options.
 
 Key findings indicate that locations within 200 meters of university gates see 40% higher foot traffic. However, competition is fierce with 22 existing cafes in the immediate area.
 
 Rent prices have stabilized around 12,000 EGP monthly for small kiosk-sized spaces. The optimal strategy for new entrants is to focus on speed of service and consistent quality to differentiate from existing competitors.
 
 Morning rush hours (7-9 AM) account for 60% of daily sales, suggesting the importance of efficient morning operations.`
 };
 
 const mapStats = [
   { icon: Coffee, label: 'Cafes', count: 22, color: 'text-yellow-400' },
   { icon: Building, label: 'Restaurants', count: 15, color: 'text-cyan-400' },
   { icon: Pill, label: 'Pharmacies', count: 9, color: 'text-green-400' },
 ];
 
 export default function ResearchScreen() {
   const navigate = useNavigate();
   const { t, isRTL } = useLanguage();
   const [steps, setSteps] = useState(initialSteps);
   const [currentStep, setCurrentStep] = useState(0);
   const [isComplete, setIsComplete] = useState(false);
 
   useEffect(() => {
     if (currentStep < steps.length) {
       // Set current step to running
       const timer1 = setTimeout(() => {
         setSteps(prev => prev.map((s, i) => 
           i === currentStep ? { ...s, status: 'running' } : s
         ));
       }, 500);
 
       // Complete current step and move to next
       const timer2 = setTimeout(() => {
         setSteps(prev => prev.map((s, i) => 
           i === currentStep ? { ...s, status: 'done' } : s
         ));
         setCurrentStep(prev => prev + 1);
       }, 2000 + Math.random() * 1000);
 
       return () => {
         clearTimeout(timer1);
         clearTimeout(timer2);
       };
     } else if (currentStep >= steps.length) {
       setIsComplete(true);
     }
   }, [currentStep, steps.length]);
 
   return (
     <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
       {/* Top Bar */}
       <header className="sticky top-0 z-50 liquid-glass border-b border-border/50">
         <div className="container mx-auto px-6 py-4 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <Search className="w-6 h-6 text-cyan-400" />
             <span className="text-lg font-bold text-foreground">Agent Research</span>
           </div>
           <Badge variant="outline" className="liquid-glass-button">
             <Loader2 className={`w-4 h-4 mr-2 ${!isComplete ? 'animate-spin' : ''}`} />
             {isComplete ? 'Complete' : 'Processing...'}
           </Badge>
         </div>
       </header>
 
       <main className="container mx-auto px-6 py-8">
         <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
           {/* Left Column: Timeline */}
           <motion.div 
             initial={{ opacity: 0, x: -20 }}
             animate={{ opacity: 1, x: 0 }}
             className="lg:col-span-3 liquid-glass rounded-2xl p-6"
           >
             <h2 className="text-lg font-bold text-foreground mb-6">Research Timeline</h2>
             <div className="space-y-4">
               {steps.map((step, index) => (
                 <motion.div
                   key={step.id}
                   initial={{ opacity: 0, x: -10 }}
                   animate={{ opacity: 1, x: 0 }}
                   transition={{ delay: index * 0.1 }}
                   className={`flex items-start gap-3 p-3 rounded-xl transition-colors ${
                     step.status === 'running' ? 'bg-cyan-500/10 border border-cyan-500/30' :
                     step.status === 'done' ? 'bg-green-500/10' : 'opacity-50'
                   }`}
                 >
                   <div className={`p-2 rounded-lg ${
                     step.status === 'running' ? 'bg-cyan-500/20' :
                     step.status === 'done' ? 'bg-green-500/20' : 'bg-secondary'
                   }`}>
                     {step.status === 'running' ? (
                       <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                     ) : step.status === 'done' ? (
                       <CheckCircle className="w-4 h-4 text-green-400" />
                     ) : (
                       <step.icon className="w-4 h-4 text-muted-foreground" />
                     )}
                   </div>
                   <p className={`text-sm ${
                     step.status === 'done' ? 'text-foreground' : 'text-muted-foreground'
                   }`}>
                     {isRTL ? step.titleAr : step.title}
                   </p>
                 </motion.div>
               ))}
             </div>
           </motion.div>
 
           {/* Middle Column: Reader View */}
           <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.2 }}
             className="lg:col-span-5 liquid-glass rounded-2xl p-6"
           >
             <div className="flex items-center gap-2 mb-4">
               <Button variant="secondary" size="sm" className="rounded-full">Page 1</Button>
               <Button variant="ghost" size="sm" className="rounded-full">Page 2</Button>
               <Button variant="ghost" size="sm" className="rounded-full">Page 3</Button>
             </div>
             
             {currentStep < 3 ? (
               <div className="space-y-4">
                 <Skeleton className="h-8 w-3/4" />
                 <Skeleton className="h-4 w-1/2" />
                 <Skeleton className="h-32 w-full" />
                 <Skeleton className="h-24 w-full" />
               </div>
             ) : (
               <AnimatePresence>
                 <motion.div
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   className="space-y-4"
                 >
                   <h3 className="text-xl font-bold text-foreground">{readerContent.title}</h3>
                   <a href={readerContent.url} className="text-sm text-cyan-400 flex items-center gap-1">
                     {readerContent.url}
                     <ExternalLink className="w-3 h-3" />
                   </a>
                   <div className="prose prose-invert prose-sm max-w-none">
                     <p className="text-muted-foreground whitespace-pre-line">{readerContent.content}</p>
                   </div>
                 </motion.div>
               </AnimatePresence>
             )}
           </motion.div>
 
           {/* Right Column: Evidence + Map */}
           <motion.div 
             initial={{ opacity: 0, x: 20 }}
             animate={{ opacity: 1, x: 0 }}
             transition={{ delay: 0.3 }}
             className="lg:col-span-4 space-y-6"
           >
             {/* Evidence Cards */}
             <div className="liquid-glass rounded-2xl p-6">
               <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                 <CreditCard className="w-5 h-5 text-yellow-400" />
                 Evidence Cards
               </h2>
               <div className="space-y-3">
                 {evidenceCards.map((evidence, index) => (
                   <motion.div
                     key={evidence.id}
                     initial={{ opacity: 0, x: 10 }}
                     animate={{ opacity: currentStep >= 4 ? 1 : 0.3, x: 0 }}
                     transition={{ delay: index * 0.1 }}
                     className="p-3 rounded-xl bg-secondary/50 border border-border/50"
                   >
                     <Badge variant="outline" className="mb-2">{evidence.id}</Badge>
                     <p className="text-sm text-foreground">{isRTL ? evidence.textAr : evidence.text}</p>
                   </motion.div>
                 ))}
               </div>
             </div>
 
             {/* Sources */}
             <div className="liquid-glass rounded-2xl p-6">
               <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                 <Globe className="w-5 h-5 text-cyan-400" />
                 Sources
               </h2>
               <div className="space-y-2">
                 {sources.map((source, index) => (
                   <a
                     key={index}
                     href={source.url}
                     className="flex items-center gap-2 text-sm text-muted-foreground hover:text-cyan-400 transition-colors"
                   >
                     <ChevronRight className="w-4 h-4" />
                     {source.title}
                   </a>
                 ))}
               </div>
             </div>
 
             {/* Map Panel */}
             <div className="liquid-glass rounded-2xl p-6">
               <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                 <MapPin className="w-5 h-5 text-green-400" />
                 Area Analysis
               </h2>
               <div className="aspect-video rounded-xl bg-secondary/50 mb-4 flex items-center justify-center">
                 <span className="text-muted-foreground text-sm">OpenStreetMap Preview</span>
               </div>
               <div className="grid grid-cols-3 gap-3">
                 {mapStats.map((stat) => (
                   <div key={stat.label} className="text-center p-3 rounded-xl bg-secondary/30">
                     <stat.icon className={`w-5 h-5 mx-auto mb-1 ${stat.color}`} />
                     <p className="text-lg font-bold text-foreground">{stat.count}</p>
                     <p className="text-xs text-muted-foreground">{stat.label}</p>
                   </div>
                 ))}
               </div>
             </div>
           </motion.div>
         </div>
 
         {/* Bottom Button */}
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: isComplete ? 1 : 0.5, y: 0 }}
           className="fixed bottom-6 left-1/2 -translate-x-1/2"
         >
           <Button
             size="lg"
             disabled={!isComplete}
             onClick={() => navigate('/app')}
             className="liquid-glass-button px-8 py-6 text-lg rounded-full rgb-shadow-hover"
           >
             <Play className="w-5 h-5 mr-2" />
             Proceed to Simulation
             <ArrowRight className="w-5 h-5 ml-2" />
           </Button>
         </motion.div>
       </main>
     </div>
   );
 }