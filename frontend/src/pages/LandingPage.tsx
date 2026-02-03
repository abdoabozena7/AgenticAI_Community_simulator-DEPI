import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * LandingPage
 *
 * This page is shown after a user successfully logs in. It fetches
 * the current user from the backend via `/auth/me` and displays
 * their remaining credits and role. Users can redeem promo codes
 * here and navigate to other sections of the app. Admin users see
 * a link to the admin dashboard.
 */
const LandingPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: number; role: string; credits: number } | null>(null);
  const [promo, setPromo] = useState('');
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);

  // Fetch current user on mount. If the token is missing or invalid,
  // redirect to the login page.
  useEffect(() => {
    const fetchMe = async () => {
      try {
        const me = await apiService.getMe();
        setUser(me);
      } catch (err) {
        // On error, assume no valid session and go to login
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, [navigate]);

  const handleRedeem = async () => {
    if (!promo.trim()) return;
    try {
      const res = await apiService.redeemPromo(promo.trim());
      setRedeemMessage(`تم إضافة ${res.bonus_attempts} نقطة إلى رصيدك.`);
      // Refresh user credits
      const me = await apiService.getMe();
      setUser(me);
      setPromo('');
    } catch (err: any) {
      setRedeemMessage(err.message || 'فشل في تفعيل الكود');
    }
  };

  const handleLogout = async () => {
    await apiService.logout();
    navigate('/login');
  };

  if (loading) {
    return <div className="p-4">جاري التحميل...</div>;
  }

  if (!user) {
    return <div className="p-4">لم يتم العثور على المستخدم.</div>;
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">مرحبًا بك في محاكاة الأفكار</h1>
      <p>المعرف: {user.id}</p>
      <p>الدور: {user.role}</p>
      <p>الرصيد المتبقي: {user.credits}</p>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">تفعيل رمز ترويجي</h2>
        <div className="flex gap-2">
          <Input
            value={promo}
            placeholder="أدخل رمز الكوبون"
            onChange={(e) => setPromo(e.target.value)}
          />
          <Button onClick={handleRedeem}>تفعيل</Button>
        </div>
        {redeemMessage && <p className="text-sm text-muted-foreground">{redeemMessage}</p>}
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">التنقل</h2>
        <Button className="w-full" onClick={() => navigate('/')}>بدء المحاكاة</Button>
        <Button className="w-full" onClick={() => navigate('/research')}>بحث السوق</Button>
        <Button className="w-full" onClick={() => navigate('/court')}>محكمة الأفكار</Button>
        {user.role === 'admin' && (
          <Button className="w-full" onClick={() => navigate('/admin')}>لوحة التحكم</Button>
        )}
      </div>

      <Button variant="secondary" className="w-full" onClick={handleLogout}>تسجيل الخروج</Button>
    </div>
  );
};

export default LandingPage;