'use client'

import { useState } from 'react';
import { supabaseClient } from '../../lib/supabaseClient'; // Assumi che esista
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async () => {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        console.error('Login error:', error);
      } else {
        // Refresh sessione per sync cookies dopo login
        await supabaseClient.auth.refreshSession();
        console.log('Sessione refreshed dopo login:', data.session); // Log per debug
        console.log('Login successful, redirecting to /');
        router.push('/');
      }
    } catch (err) {
      setError('Errore imprevisto durante il login');
      console.error('Exception in handleLogin:', err);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center flex-col">
      <h1>Login</h1>
      <input 
        type="email" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)} 
        placeholder="Email" 
        className="bg-zinc-800 text-white p-2 mb-2"
      />
      <input 
        type="password" 
        value={password} 
        onChange={(e) => setPassword(e.target.value)} 
        placeholder="Password" 
        className="bg-zinc-800 text-white p-2 mb-2"
      />
      <button onClick={handleLogin} className="bg-green-700 text-white px-4 py-2 rounded">Login</button>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
}