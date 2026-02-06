 import { useState } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { 
   Scale, Shield, Gavel, CheckCircle, AlertTriangle, XCircle,
   ChevronDown, ChevronUp, ArrowRight, Loader2, Target, AlertCircle
 } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Textarea } from '@/components/ui/textarea';
 import { Badge } from '@/components/ui/badge';
 import { useLanguage } from '@/contexts/LanguageContext';
 
 interface CourtResult {
   defense: string[];
   prosecution: string[];
   verdict: 'strong' | 'medium' | 'weak';
   verdictText: string;
   successConditions: string[];
   risks: string[];
   nextSteps: string[];
 }
 
 const sampleResult: CourtResult = {
   defense: [
     'High demand in university areas for quick coffee service',
     'Low initial investment compared to full café',
     'Proven business model with fast ROI potential',
     'Flexible location options near high-traffic areas',
     'Growing coffee culture among young demographics',
   ],
   prosecution: [
     'Intense competition from 22 existing cafes in the area',
     'High rent prices may squeeze profit margins',
     'Seasonal fluctuations during university breaks',
     'Limited product differentiation opportunities',
     'Weather dependency for outdoor kiosk operations',
   ],
   verdict: 'medium',
   verdictText: 'الفكرة قوية بس محتاجة تميّز واضح في المنتج وتجربة أسرع من المنافسين.',
   successConditions: [
     'Secure location within 200m of university gate',
     'Maintain service time under 2 minutes',
     'Achieve 60% of sales in morning rush',
     'Keep monthly rent under 12,000 EGP',
   ],
   risks: [
     'University policy changes on vendor permits',
     'New competitors entering the market',
     'Supply chain disruptions for coffee beans',
     'Economic downturn affecting discretionary spending',
   ],
   nextSteps: [
     'Survey potential locations near university gates',
     'Calculate detailed financial projections',
     'Research permit requirements from local authorities',
     'Develop unique menu offerings for differentiation',
     'Create supplier relationships for consistent quality',
     'Design efficient workflow for 2-minute service',
     'Plan soft launch with student feedback program',
   ],
 };
 
 export default function IdeaCourt() {
   const { isRTL } = useLanguage();
   const [idea, setIdea] = useState('');
   const [isProcessing, setIsProcessing] = useState(false);
   const [result, setResult] = useState<CourtResult | null>(null);
   const [expandedSections, setExpandedSections] = useState<string[]>(['defense', 'prosecution', 'verdict']);
 
   const handleSubmit = () => {
     if (!idea.trim()) return;
     setIsProcessing(true);
     setTimeout(() => {
       setResult(sampleResult);
       setIsProcessing(false);
     }, 3000);
   };
 
   const toggleSection = (section: string) => {
     setExpandedSections(prev => 
       prev.includes(section) 
         ? prev.filter(s => s !== section)
         : [...prev, section]
     );
   };
 
   const getVerdictConfig = (verdict: string) => {
     switch (verdict) {
       case 'strong':
         return { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Strong' };
       case 'medium':
         return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Medium' };
       case 'weak':
         return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Weak' };
       default:
         return { icon: Scale, color: 'text-muted-foreground', bg: 'bg-secondary', label: 'Unknown' };
     }
   };
 
   return (
     <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
       {/* Header */}
       <header className="sticky top-0 z-50 liquid-glass border-b border-border/50">
         <div className="container mx-auto px-6 py-4 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <Scale className="w-6 h-6 text-purple-400" />
             <span className="text-lg font-bold text-foreground">Idea Court</span>
           </div>
         </div>
       </header>
 
       <main className="container mx-auto px-6 py-8 max-w-4xl">
         {/* Input Card */}
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="liquid-glass rounded-2xl p-6 mb-8"
         >
           <h2 className="text-xl font-bold text-foreground mb-4">Describe Your Idea</h2>
           <Textarea
             placeholder="كشك قهوة سريع جنب جامعة في مدينة نصر..."
             value={idea}
             onChange={(e) => setIdea(e.target.value)}
             className="min-h-32 bg-secondary/50 border-border mb-4"
           />
           <Button
             onClick={handleSubmit}
             disabled={isProcessing || !idea.trim()}
             className="w-full liquid-glass-button py-6 text-lg"
           >
             {isProcessing ? (
               <>
                 <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                 Running Idea Court...
               </>
             ) : (
               <>
                 <Gavel className="w-5 h-5 mr-2" />
                 Run Idea Court
               </>
             )}
           </Button>
         </motion.div>
 
         {/* Results */}
         <AnimatePresence>
           {result && (
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="space-y-6"
             >
               {/* Defense */}
               <div className="liquid-glass rounded-2xl overflow-hidden">
                 <button
                   onClick={() => toggleSection('defense')}
                   className="w-full p-6 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                 >
                   <div className="flex items-center gap-3">
                     <Shield className="w-6 h-6 text-green-400" />
                     <span className="text-lg font-bold text-foreground">Defense AI</span>
                   </div>
                   {expandedSections.includes('defense') ? (
                     <ChevronUp className="w-5 h-5 text-muted-foreground" />
                   ) : (
                     <ChevronDown className="w-5 h-5 text-muted-foreground" />
                   )}
                 </button>
                 <AnimatePresence>
                   {expandedSections.includes('defense') && (
                     <motion.div
                       initial={{ height: 0, opacity: 0 }}
                       animate={{ height: 'auto', opacity: 1 }}
                       exit={{ height: 0, opacity: 0 }}
                       className="px-6 pb-6"
                     >
                       <ul className="space-y-2">
                         {result.defense.map((point, i) => (
                           <li key={i} className="flex items-start gap-3 text-muted-foreground">
                             <CheckCircle className="w-4 h-4 text-green-400 mt-1 shrink-0" />
                             {point}
                           </li>
                         ))}
                       </ul>
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
 
               {/* Prosecution */}
               <div className="liquid-glass rounded-2xl overflow-hidden">
                 <button
                   onClick={() => toggleSection('prosecution')}
                   className="w-full p-6 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                 >
                   <div className="flex items-center gap-3">
                     <Gavel className="w-6 h-6 text-red-400" />
                     <span className="text-lg font-bold text-foreground">Prosecution AI</span>
                   </div>
                   {expandedSections.includes('prosecution') ? (
                     <ChevronUp className="w-5 h-5 text-muted-foreground" />
                   ) : (
                     <ChevronDown className="w-5 h-5 text-muted-foreground" />
                   )}
                 </button>
                 <AnimatePresence>
                   {expandedSections.includes('prosecution') && (
                     <motion.div
                       initial={{ height: 0, opacity: 0 }}
                       animate={{ height: 'auto', opacity: 1 }}
                       exit={{ height: 0, opacity: 0 }}
                       className="px-6 pb-6"
                     >
                       <ul className="space-y-2">
                         {result.prosecution.map((point, i) => (
                           <li key={i} className="flex items-start gap-3 text-muted-foreground">
                             <XCircle className="w-4 h-4 text-red-400 mt-1 shrink-0" />
                             {point}
                           </li>
                         ))}
                       </ul>
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
 
               {/* Verdict */}
               <div className="liquid-glass rounded-2xl overflow-hidden">
                 <button
                   onClick={() => toggleSection('verdict')}
                   className="w-full p-6 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                 >
                   <div className="flex items-center gap-3">
                     <Scale className="w-6 h-6 text-purple-400" />
                     <span className="text-lg font-bold text-foreground">Judge Verdict</span>
                   </div>
                   {expandedSections.includes('verdict') ? (
                     <ChevronUp className="w-5 h-5 text-muted-foreground" />
                   ) : (
                     <ChevronDown className="w-5 h-5 text-muted-foreground" />
                   )}
                 </button>
                 <AnimatePresence>
                   {expandedSections.includes('verdict') && (
                     <motion.div
                       initial={{ height: 0, opacity: 0 }}
                       animate={{ height: 'auto', opacity: 1 }}
                       exit={{ height: 0, opacity: 0 }}
                       className="px-6 pb-6"
                     >
                       {(() => {
                         const config = getVerdictConfig(result.verdict);
                         return (
                           <div className={`p-4 rounded-xl ${config.bg} flex items-center gap-4`}>
                             <config.icon className={`w-10 h-10 ${config.color}`} />
                             <div>
                               <Badge className={config.bg}>{config.label}</Badge>
                               <p className="text-foreground mt-2 font-arabic">{result.verdictText}</p>
                             </div>
                           </div>
                         );
                       })()}
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
 
               {/* Success Conditions */}
               <div className="liquid-glass rounded-2xl p-6">
                 <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                   <Target className="w-5 h-5 text-green-400" />
                   Success Conditions
                 </h3>
                 <ul className="space-y-2">
                   {result.successConditions.map((condition, i) => (
                     <li key={i} className="flex items-center gap-3 text-muted-foreground">
                       <CheckCircle className="w-4 h-4 text-green-400" />
                       {condition}
                     </li>
                   ))}
                 </ul>
               </div>
 
               {/* Risks */}
               <div className="liquid-glass rounded-2xl p-6">
                 <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                   <AlertCircle className="w-5 h-5 text-yellow-400" />
                   Risks
                 </h3>
                 <ul className="space-y-2">
                   {result.risks.map((risk, i) => (
                     <li key={i} className="flex items-center gap-3 text-muted-foreground">
                       <AlertTriangle className="w-4 h-4 text-yellow-400" />
                       {risk}
                     </li>
                   ))}
                 </ul>
               </div>
 
               {/* Next Steps */}
               <div className="liquid-glass rounded-2xl p-6">
                 <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                   <ArrowRight className="w-5 h-5 text-cyan-400" />
                   Next Steps
                 </h3>
                 <ol className="space-y-3">
                   {result.nextSteps.map((step, i) => (
                     <li key={i} className="flex items-start gap-3 text-muted-foreground">
                       <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-sm font-bold shrink-0">
                         {i + 1}
                       </span>
                       {step}
                     </li>
                   ))}
                 </ol>
               </div>
             </motion.div>
           )}
         </AnimatePresence>
       </main>
     </div>
   );
 }