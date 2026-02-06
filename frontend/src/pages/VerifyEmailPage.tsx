import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiService } from '@/services/api';
import { Button } from '@/components/ui/button';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Verification token missing.');
      return;
    }
    apiService
      .verifyEmail(token)
      .then(() => {
        setStatus('success');
        setMessage('Email verified successfully.');
      })
      .catch((err: any) => {
        setStatus('error');
        setMessage(err?.message || 'Verification failed.');
      });
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
      <div className="max-w-md w-full rounded-2xl liquid-glass p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold">Email Verification</h1>
        {status === 'verifying' && <p>Verifying your email...</p>}
        {status !== 'verifying' && <p>{message}</p>}
        <Button onClick={() => navigate('/?auth=login')} className="w-full">
          Go to Login
        </Button>
      </div>
    </div>
  );
}
