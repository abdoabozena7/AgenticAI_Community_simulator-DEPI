 import { useState } from 'react';
 import { useNavigate } from 'react-router-dom';
 import { motion } from 'framer-motion';
 import { 
   Zap, MapPin, Tag, ArrowRight, CheckCircle, XCircle, 
   LogOut, CreditCard, User, Search, Scale
 } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Badge } from '@/components/ui/badge';
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from "@/components/ui/select";
 import { useLanguage } from '@/contexts/LanguageContext';
 
 const categories = [
   { value: 'default', label: 'Default', labelAr: 'افتراضي' },
   { value: 'food', label: 'Food', labelAr: 'طعام' },
   { value: 'retail', label: 'Retail', labelAr: 'تجزئة' },
   { value: 'education', label: 'Education', labelAr: 'تعليم' },
   { value: 'healthcare', label: 'Healthcare', labelAr: 'صحة' },
   { value: 'services', label: 'Services', labelAr: 'خدمات' },
   { value: 'tech', label: 'Tech', labelAr: 'تقنية' },
 ];
 
 export default function UserHome() {
   const navigate = useNavigate();
   const { t, isRTL } = useLanguage();
   const [idea, setIdea] = useState('');
   const [location, setLocation] = useState('');
   const [category, setCategory] = useState('default');
   const [promoCode, setPromoCode] = useState('');
   const [promoStatus, setPromoStatus] = useState<'idle' | 'success' | 'error'>('idle');
 
   const handleStartResearch = () => {
     if (idea.trim()) {
       navigate('/research');
     }
   };
 
   const handleRedeemPromo = () => {
     if (promoCode.toUpperCase() === 'WELCOME2024') {
       setPromoStatus('success');
     } else {
       setPromoStatus('error');
     }
   };
 
   const handleLogout = () => {
     navigate('/');
   };
 
   return (
     <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
       {/* Top Bar */}
       <header className="sticky top-0 z-50 liquid-glass border-b border-border/50">
         <div className="container mx-auto px-6 py-4 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <Zap className="w-8 h-8 text-primary" />
             <span className="text-xl font-bold text-foreground">Agentic Simulator</span>
           </div>
           
           <nav className="hidden md:flex items-center gap-6">
             <Button variant="ghost" onClick={() => navigate('/research')}>
               <Search className="w-4 h-4 mr-2" />
               Research
             </Button>
             <Button variant="ghost" onClick={() => navigate('/idea-court')}>
               <Scale className="w-4 h-4 mr-2" />
               Idea Court
             </Button>
             <Button variant="ghost" onClick={() => navigate('/dashboard')}>
               Dashboard
             </Button>
           </nav>
 
           <div className="flex items-center gap-4">
             <Badge variant="outline" className="px-3 py-1.5 liquid-glass-button">
               <User className="w-4 h-4 mr-2" />
               Demo User
               <span className="ml-2 text-primary">15 Credits</span>
             </Badge>
             <Button
               variant="ghost"
               size="sm"
               onClick={handleLogout}
               className="text-destructive hover:text-destructive hover:bg-destructive/10"
             >
               <LogOut className="w-4 h-4 mr-2" />
               Logout
             </Button>
           </div>
         </div>
       </header>
 
       <main className="container mx-auto px-6 py-12 max-w-4xl space-y-8">
         {/* Start Research Card */}
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="liquid-glass rounded-2xl p-8"
         >
           <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-3">
             <Search className="w-7 h-7 text-primary" />
             Start Research
           </h2>
 
           <div className="space-y-5">
             <div>
               <label className="text-sm text-muted-foreground mb-2 block">Idea</label>
               <Input
                 placeholder="مثال: Coffee kiosk concept"
                 value={idea}
                 onChange={(e) => setIdea(e.target.value)}
                 className="bg-secondary/50 border-border text-lg py-6"
               />
             </div>
 
             <div>
               <label className="text-sm text-muted-foreground mb-2 block">Place/Area (optional)</label>
               <div className="relative">
                 <MapPin className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground`} />
                 <Input
                   placeholder="مثال: Nasr City, Cairo"
                   value={location}
                   onChange={(e) => setLocation(e.target.value)}
                   className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary/50 border-border`}
                 />
               </div>
             </div>
 
             <div>
               <label className="text-sm text-muted-foreground mb-2 block">Category</label>
               <Select value={category} onValueChange={setCategory}>
                 <SelectTrigger className="bg-secondary/50 border-border">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   {categories.map((cat) => (
                     <SelectItem key={cat.value} value={cat.value}>
                       {isRTL ? cat.labelAr : cat.label}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
 
             <Button
               onClick={handleStartResearch}
               disabled={!idea.trim()}
               className="w-full liquid-glass-button py-6 text-lg rgb-shadow-hover"
             >
               <Zap className="w-5 h-5 mr-2" />
               Start Agent Research
               <ArrowRight className="w-5 h-5 ml-2" />
             </Button>
           </div>
         </motion.div>
 
         {/* Promo Code Card */}
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
           className="liquid-glass rounded-2xl p-6"
         >
           <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
             <Tag className="w-5 h-5 text-primary" />
             Promo Code
           </h3>
 
           <div className="flex gap-3">
             <Input
               placeholder="Enter promo code"
               value={promoCode}
               onChange={(e) => {
                 setPromoCode(e.target.value);
                 setPromoStatus('idle');
               }}
               className="flex-1 bg-secondary/50 border-border"
             />
             <Button onClick={handleRedeemPromo} variant="secondary">
               Redeem
             </Button>
           </div>
 
           {promoStatus === 'success' && (
             <motion.div
               initial={{ opacity: 0, y: -10 }}
               animate={{ opacity: 1, y: 0 }}
               className="mt-3 flex items-center gap-2 text-success"
             >
               <CheckCircle className="w-4 h-4" />
               <span>✅ Added +3 attempts</span>
             </motion.div>
           )}
 
           {promoStatus === 'error' && (
             <motion.div
               initial={{ opacity: 0, y: -10 }}
               animate={{ opacity: 1, y: 0 }}
               className="mt-3 flex items-center gap-2 text-destructive"
             >
               <XCircle className="w-4 h-4" />
               <span>❌ Invalid code</span>
             </motion.div>
           )}
         </motion.div>
       </main>
     </div>
   );
 }