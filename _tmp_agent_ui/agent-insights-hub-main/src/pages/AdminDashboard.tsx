 import { useState } from 'react';
 import { useNavigate } from 'react-router-dom';
 import { motion } from 'framer-motion';
 import { 
   Users, Activity, CreditCard, Calendar, Search, Plus, Eye, 
   LogOut, Settings, Shield, Ticket, CheckCircle, XCircle,
   TrendingUp, Clock, MoreHorizontal
 } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Badge } from '@/components/ui/badge';
 import { useLanguage } from '@/contexts/LanguageContext';
 
 interface User {
   id: number;
   username: string;
   email: string;
   role: 'admin' | 'user';
   credits: number;
   simulations: number;
   lastActive: string;
 }
 
 interface PromoCode {
   id: number;
   code: string;
   bonus: number;
   uses: number;
   maxUses: number;
   expiry: string;
   status: 'active' | 'expired';
 }
 
 const dummyUsers: User[] = [
   { id: 1, username: 'ahmed_mohamed', email: 'ahmed@example.com', role: 'user', credits: 15, simulations: 23, lastActive: 'Today' },
   { id: 2, username: 'sara_ali', email: 'sara@example.com', role: 'user', credits: 8, simulations: 12, lastActive: 'Yesterday' },
   { id: 3, username: 'admin', email: 'admin@system.com', role: 'admin', credits: 999, simulations: 156, lastActive: 'Now' },
   { id: 4, username: 'omar_hassan', email: 'omar@example.com', role: 'user', credits: 3, simulations: 45, lastActive: '2 days ago' },
   { id: 5, username: 'fatima_youssef', email: 'fatima@example.com', role: 'user', credits: 21, simulations: 8, lastActive: 'Today' },
 ];
 
 const dummyPromoCodes: PromoCode[] = [
   { id: 1, code: 'WELCOME2024', bonus: 5, uses: 234, maxUses: 500, expiry: '2024-12-31', status: 'active' },
   { id: 2, code: 'RAMADAN50', bonus: 10, uses: 50, maxUses: 50, expiry: '2024-04-15', status: 'expired' },
   { id: 3, code: 'STUDENT25', bonus: 3, uses: 89, maxUses: 200, expiry: '2025-06-30', status: 'active' },
 ];
 
 export default function AdminDashboard() {
   const navigate = useNavigate();
   const { t, isRTL } = useLanguage();
   const [searchQuery, setSearchQuery] = useState('');
   const [newPromoCode, setNewPromoCode] = useState({ code: '', bonus: 5, maxUses: 100, expiry: '' });
 
   const stats = [
     { label: 'Total Users', value: '1,247', icon: Users, color: 'text-cyan-400' },
     { label: 'Total Simulations', value: '8,934', icon: Activity, color: 'text-green-400' },
     { label: 'Today Usage', value: '156', icon: TrendingUp, color: 'text-yellow-400' },
     { label: 'Credits Issued', value: '45,230', icon: CreditCard, color: 'text-purple-400' },
   ];
 
   const handleLogout = () => {
     navigate('/');
   };
 
   const handleCreatePromo = () => {
     console.log('Creating promo:', newPromoCode);
     setNewPromoCode({ code: '', bonus: 5, maxUses: 100, expiry: '' });
   };
 
   return (
     <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
       {/* Top Bar */}
       <header className="sticky top-0 z-50 liquid-glass border-b border-border/50">
         <div className="container mx-auto px-6 py-4 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <Shield className="w-8 h-8 text-cyan-400" />
             <span className="text-xl font-bold text-foreground">Admin Panel</span>
           </div>
           
           <div className="flex items-center gap-4">
             <Badge variant="outline" className="px-3 py-1.5 liquid-glass-button">
               <Shield className="w-4 h-4 mr-2 text-cyan-400" />
               Administrator
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
 
       <main className="container mx-auto px-6 py-8 space-y-8">
         {/* Stats Grid */}
         <motion.div 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
         >
           {stats.map((stat, index) => (
             <motion.div
               key={stat.label}
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: index * 0.1 }}
               className="liquid-glass rounded-2xl p-6"
             >
               <div className="flex items-center justify-between mb-4">
                 <stat.icon className={`w-8 h-8 ${stat.color}`} />
                 <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
               </div>
               <p className="text-3xl font-bold text-foreground">{stat.value}</p>
               <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
             </motion.div>
           ))}
         </motion.div>
 
         {/* Users Table */}
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.2 }}
           className="liquid-glass rounded-2xl p-6"
         >
           <div className="flex items-center justify-between mb-6">
             <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
               <Users className="w-5 h-5 text-cyan-400" />
               Users Management
             </h2>
             <div className="relative w-64">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
               <Input
                 placeholder="Search users..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="pl-10 bg-secondary/50 border-border"
               />
             </div>
           </div>
 
           <div className="overflow-x-auto">
             <table className="w-full">
               <thead>
                 <tr className="border-b border-border">
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Username</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Email</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Role</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Credits</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Simulations</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Last Active</th>
                   <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                 </tr>
               </thead>
               <tbody>
                 {dummyUsers.filter(u => 
                   u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
                   u.email.toLowerCase().includes(searchQuery.toLowerCase())
                 ).map((user) => (
                   <tr key={user.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                     <td className="py-4 px-4 font-medium text-foreground">{user.username}</td>
                     <td className="py-4 px-4 text-muted-foreground">{user.email}</td>
                     <td className="py-4 px-4">
                       <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                         {user.role === 'admin' ? <Shield className="w-3 h-3 mr-1" /> : null}
                         {user.role}
                       </Badge>
                     </td>
                     <td className="py-4 px-4 text-foreground">{user.credits}</td>
                     <td className="py-4 px-4 text-foreground">{user.simulations}</td>
                     <td className="py-4 px-4 text-muted-foreground">{user.lastActive}</td>
                     <td className="py-4 px-4">
                       <div className="flex gap-2">
                         <Button variant="ghost" size="sm" className="h-8">
                           <Eye className="w-4 h-4" />
                         </Button>
                         <Button variant="ghost" size="sm" className="h-8">
                           <Plus className="w-4 h-4" />
                         </Button>
                       </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </motion.div>
 
         {/* Promo Codes Section */}
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           {/* Create Promo Code */}
           <motion.div
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.3 }}
             className="liquid-glass rounded-2xl p-6"
           >
             <h2 className="text-xl font-bold text-foreground flex items-center gap-2 mb-6">
               <Ticket className="w-5 h-5 text-yellow-400" />
               Create Promo Code
             </h2>
             
             <div className="space-y-4">
               <div>
                 <label className="text-sm text-muted-foreground mb-2 block">Code</label>
                 <Input
                   placeholder="PROMO2024"
                   value={newPromoCode.code}
                   onChange={(e) => setNewPromoCode({ ...newPromoCode, code: e.target.value.toUpperCase() })}
                   className="bg-secondary/50 border-border"
                 />
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="text-sm text-muted-foreground mb-2 block">Bonus Credits</label>
                   <Input
                     type="number"
                     value={newPromoCode.bonus}
                     onChange={(e) => setNewPromoCode({ ...newPromoCode, bonus: parseInt(e.target.value) })}
                     className="bg-secondary/50 border-border"
                   />
                 </div>
                 <div>
                   <label className="text-sm text-muted-foreground mb-2 block">Max Uses</label>
                   <Input
                     type="number"
                     value={newPromoCode.maxUses}
                     onChange={(e) => setNewPromoCode({ ...newPromoCode, maxUses: parseInt(e.target.value) })}
                     className="bg-secondary/50 border-border"
                   />
                 </div>
               </div>
 
               <div>
                 <label className="text-sm text-muted-foreground mb-2 block">Expiration Date</label>
                 <Input
                   type="date"
                   value={newPromoCode.expiry}
                   onChange={(e) => setNewPromoCode({ ...newPromoCode, expiry: e.target.value })}
                   className="bg-secondary/50 border-border"
                 />
               </div>
 
               <Button onClick={handleCreatePromo} className="w-full liquid-glass-button">
                 <Plus className="w-4 h-4 mr-2" />
                 Create Promo Code
               </Button>
             </div>
           </motion.div>
 
           {/* Promo Codes List */}
           <motion.div
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.4 }}
             className="liquid-glass rounded-2xl p-6"
           >
             <h2 className="text-xl font-bold text-foreground flex items-center gap-2 mb-6">
               <Ticket className="w-5 h-5 text-purple-400" />
               Active Promo Codes
             </h2>
             
             <div className="space-y-4">
               {dummyPromoCodes.map((promo) => (
                 <div key={promo.id} className="p-4 rounded-xl bg-secondary/30 border border-border/50">
                   <div className="flex items-center justify-between mb-2">
                     <code className="text-lg font-mono font-bold text-foreground">{promo.code}</code>
                     <Badge variant={promo.status === 'active' ? 'default' : 'secondary'}>
                       {promo.status === 'active' ? (
                         <CheckCircle className="w-3 h-3 mr-1" />
                       ) : (
                         <XCircle className="w-3 h-3 mr-1" />
                       )}
                       {promo.status}
                     </Badge>
                   </div>
                   <div className="flex items-center gap-4 text-sm text-muted-foreground">
                     <span>+{promo.bonus} credits</span>
                     <span>•</span>
                     <span>{promo.uses}/{promo.maxUses} uses</span>
                     <span>•</span>
                     <span className="flex items-center gap-1">
                       <Clock className="w-3 h-3" />
                       {promo.expiry}
                     </span>
                   </div>
                 </div>
               ))}
             </div>
           </motion.div>
         </div>
       </main>
     </div>
   );
 }