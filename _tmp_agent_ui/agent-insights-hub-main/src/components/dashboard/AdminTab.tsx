import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Activity, CreditCard, TrendingUp, Search, Plus, Eye,
  Shield, Ticket, CheckCircle, XCircle, Clock, MoreHorizontal,
  Ban, Edit, Mail, UserPlus, Download, Filter, Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface UserRow {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  credits: number;
  simulations: number;
  lastActive: string;
  status: 'active' | 'suspended';
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

const dummyUsers: UserRow[] = [
  { id: 1, username: 'ahmed_mohamed', email: 'ahmed@example.com', role: 'user', credits: 15, simulations: 23, lastActive: 'Today', status: 'active' },
  { id: 2, username: 'sara_ali', email: 'sara@example.com', role: 'user', credits: 8, simulations: 12, lastActive: 'Yesterday', status: 'active' },
  { id: 3, username: 'admin', email: 'admin@system.com', role: 'admin', credits: 999, simulations: 156, lastActive: 'Now', status: 'active' },
  { id: 4, username: 'omar_hassan', email: 'omar@example.com', role: 'user', credits: 3, simulations: 45, lastActive: '2 days ago', status: 'active' },
  { id: 5, username: 'fatima_youssef', email: 'fatima@example.com', role: 'user', credits: 21, simulations: 8, lastActive: 'Today', status: 'active' },
  { id: 6, username: 'khalid_nasser', email: 'khalid@example.com', role: 'user', credits: 0, simulations: 34, lastActive: '1 week ago', status: 'suspended' },
];

const dummyPromoCodes: PromoCode[] = [
  { id: 1, code: 'WELCOME2024', bonus: 5, uses: 234, maxUses: 500, expiry: '2024-12-31', status: 'active' },
  { id: 2, code: 'RAMADAN50', bonus: 10, uses: 50, maxUses: 50, expiry: '2024-04-15', status: 'expired' },
  { id: 3, code: 'STUDENT25', bonus: 3, uses: 89, maxUses: 200, expiry: '2025-06-30', status: 'active' },
  { id: 4, code: 'LAUNCH100', bonus: 15, uses: 12, maxUses: 100, expiry: '2025-12-31', status: 'active' },
];

export default function AdminTab() {
  const { isRTL } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [newPromo, setNewPromo] = useState({ code: '', bonus: 5, maxUses: 100, expiry: '' });
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [creditAmount, setCreditAmount] = useState('5');

  const stats = [
    { label: isRTL ? 'إجمالي المستخدمين' : 'Total Users', value: '1,247', icon: Users, color: 'text-cyan-400' },
    { label: isRTL ? 'إجمالي المحاكاة' : 'Total Simulations', value: '8,934', icon: Activity, color: 'text-green-400' },
    { label: isRTL ? 'الاستخدام اليوم' : 'Today Usage', value: '156', icon: TrendingUp, color: 'text-yellow-400' },
    { label: isRTL ? 'الرصيد الصادر' : 'Credits Issued', value: '45,230', icon: CreditCard, color: 'text-purple-400' },
  ];

  const filteredUsers = dummyUsers.filter(u => {
    const matchesSearch = u.username.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-cyan-400" />
          {isRTL ? 'لوحة الإدارة' : 'Admin Dashboard'}
        </h1>
        <p className="text-muted-foreground text-sm">{isRTL ? 'إدارة المستخدمين والأكواد الترويجية' : 'Manage users and promo codes'}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="liquid-glass rounded-xl p-5">
            <stat.icon className={`w-7 h-7 mb-2 ${stat.color}`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Users Table */}
      <div className="liquid-glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="font-bold flex items-center gap-2"><Users className="w-5 h-5 text-cyan-400" />{isRTL ? 'المستخدمين' : 'Users'}</h2>
          <div className="flex items-center gap-3">
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={isRTL ? 'بحث...' : 'Search...'} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 bg-secondary/50 border-border h-9 text-sm" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-28 h-9 bg-secondary/50 border-border text-sm">
                <Filter className="w-3 h-3 mr-1" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                <SelectItem value="admin">{isRTL ? 'مسؤول' : 'Admin'}</SelectItem>
                <SelectItem value="user">{isRTL ? 'مستخدم' : 'User'}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9"><Download className="w-4 h-4 mr-1" />{isRTL ? 'تصدير' : 'Export'}</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[isRTL ? 'المستخدم' : 'User', isRTL ? 'الدور' : 'Role', isRTL ? 'الحالة' : 'Status', isRTL ? 'الرصيد' : 'Credits', isRTL ? 'المحاكاة' : 'Sims', isRTL ? 'آخر نشاط' : 'Last Active', isRTL ? 'إجراءات' : 'Actions']
                  .map(h => <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                  <td className="py-3 px-3">
                    <div>
                      <p className="font-medium text-foreground">{user.username}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                      {user.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}{user.role}
                    </Badge>
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant="outline" className={`text-xs ${user.status === 'active' ? 'text-green-400 border-green-400/30' : 'text-red-400 border-red-400/30'}`}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 font-medium">{user.credits}</td>
                  <td className="py-3 px-3">{user.simulations}</td>
                  <td className="py-3 px-3 text-muted-foreground text-xs">{user.lastActive}</td>
                  <td className="py-3 px-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View"><Eye className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Add Credits" onClick={() => setSelectedUser(user)}><Plus className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit"><Edit className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Email"><Mail className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" title={user.status === 'active' ? 'Suspend' : 'Activate'}>
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Credits Modal (inline) */}
        {selectedUser && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-sm">{isRTL ? 'إضافة رصيد لـ' : 'Add credits to'} <span className="text-cyan-400">{selectedUser.username}</span></p>
              <Button variant="ghost" size="sm" onClick={() => setSelectedUser(null)} className="h-7">{isRTL ? 'إلغاء' : 'Cancel'}</Button>
            </div>
            <div className="flex gap-2">
              <Input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="w-24 h-9 bg-secondary/50 text-sm" />
              <Button size="sm" className="h-9" onClick={() => { setSelectedUser(null); }}><Plus className="w-4 h-4 mr-1" />{isRTL ? 'إضافة' : 'Add'}</Button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Promo Codes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="liquid-glass rounded-2xl p-5">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Ticket className="w-5 h-5 text-yellow-400" />{isRTL ? 'إنشاء كود' : 'Create Promo'}</h2>
          <div className="space-y-3">
            <Input placeholder="PROMO2024" value={newPromo.code} onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} className="bg-secondary/50 border-border h-9 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{isRTL ? 'الرصيد الإضافي' : 'Bonus'}</label>
                <Input type="number" value={newPromo.bonus} onChange={(e) => setNewPromo({ ...newPromo, bonus: parseInt(e.target.value) })} className="bg-secondary/50 border-border h-9 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{isRTL ? 'الحد الأقصى' : 'Max Uses'}</label>
                <Input type="number" value={newPromo.maxUses} onChange={(e) => setNewPromo({ ...newPromo, maxUses: parseInt(e.target.value) })} className="bg-secondary/50 border-border h-9 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{isRTL ? 'تاريخ الانتهاء' : 'Expiry'}</label>
              <Input type="date" value={newPromo.expiry} onChange={(e) => setNewPromo({ ...newPromo, expiry: e.target.value })} className="bg-secondary/50 border-border h-9 text-sm" />
            </div>
            <Button className="w-full liquid-glass-button h-9 text-sm"><Plus className="w-4 h-4 mr-1" />{isRTL ? 'إنشاء' : 'Create'}</Button>
          </div>
        </div>

        <div className="liquid-glass rounded-2xl p-5">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Ticket className="w-5 h-5 text-purple-400" />{isRTL ? 'الأكواد الحالية' : 'Promo Codes'}</h2>
          <div className="space-y-3">
            {dummyPromoCodes.map((p) => (
              <div key={p.id} className="p-3 rounded-xl bg-secondary/30 border border-border/50">
                <div className="flex items-center justify-between mb-1">
                  <code className="font-mono font-bold text-sm">{p.code}</code>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {p.status === 'active' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}{p.status}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>+{p.bonus} credits</span><span>•</span>
                  <span>{p.uses}/{p.maxUses}</span><span>•</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{p.expiry}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
