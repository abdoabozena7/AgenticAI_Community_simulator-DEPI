import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiService } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const handleSubmit = async () => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Reset token missing.');
      return;
    }
    if (!password || password.length < 6) {
      setStatus('error');
      setMessage('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      await apiService.resetPassword(token, password);
      setStatus('success');
      setMessage('Password updated successfully.');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Password reset failed.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
      <div className="max-w-md w-full rounded-2xl liquid-glass p-8 space-y-4">
        <h1 className="text-2xl font-bold text-center">Reset Password</h1>
        <Input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {message && <p className="text-sm text-muted-foreground text-center">{message}</p>}
        <Button onClick={handleSubmit} disabled={status === 'loading'} className="w-full">
          {status === 'loading' ? 'Updating...' : 'Update Password'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/?auth=login')} className="w-full">
          Back to Login
        </Button>
      </div>
    </div>
  );
}
