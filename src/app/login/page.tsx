'use client'

import React, { useState } from 'react';
import { supabaseClient } from '../../lib/supabaseClient'; // Adatta path
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async () => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="bg-zinc-900 p-6 rounded-lg shadow-md w-80">
        <h2 className="text-xl font-bold mb-4">Login</h2>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (username)"
          className="bg-zinc-800 text-white p-2 mb-2 w-full rounded"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="bg-zinc-800 text-white p-2 mb-4 w-full rounded"
        />
        <button onClick={handleLogin} className="bg-green-700 text-white px-4 py-2 rounded w-full">
          Accedi
        </button>
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}