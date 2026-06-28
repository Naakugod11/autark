'use client';

/**
 * INTEGRATION PROOF — raw devnet data dump.
 *
 * This page exists only to confirm the browser-safe Autark read client
 * (web/lib/autark.ts) connects to live devnet and returns real data.
 * Layout/design/architecture are Mert's territory; see AUTARK_DASHBOARD_HANDOVER.md.
 */

import { useEffect, useState } from 'react';
import { fetchAgents, fetchRecentJobs, type AgentData, type JobOfferData } from '@/lib/autark';

export default function IntegrationProof() {
  const [agents, setAgents]   = useState<AgentData[] | null>(null);
  const [jobs,   setJobs]     = useState<JobOfferData[] | null>(null);
  const [error,  setError]    = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ts, setTs]           = useState<string>('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [a, j] = await Promise.all([fetchAgents(), fetchRecentJobs()]);
      setAgents(a);
      setJobs(j);
      setTs(new Date().toISOString());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>Autark — integration proof</h1>
      <p style={{ color: '#888', fontSize: 12 }}>
        raw devnet data · web/lib/autark.ts · {ts || '…'}
      </p>
      <button onClick={load} disabled={loading} style={{ marginBottom: 24 }}>
        {loading ? 'loading…' : 'refresh'}
      </button>

      {error && <pre style={{ color: 'red' }}>ERROR: {error}</pre>}

      <h2>Agents ({agents?.length ?? '…'})</h2>
      {agents && (
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th>pubkey</th>
              <th>owner</th>
              <th>capabilities</th>
              <th>stake (USDC)</th>
              <th>scoreCompleted</th>
              <th>scoreFailed</th>
              <th>scoreVolume (USDC)</th>
              <th>slashEvents</th>
              <th>openJobs</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.pubkey.toBase58()}>
                <td>{a.pubkey.toBase58()}</td>
                <td>{a.owner.toBase58()}</td>
                <td>{a.capabilities.join(', ')}</td>
                <td>{(a.stakeAmount / 1e6).toFixed(2)}</td>
                <td>{a.scoreCompleted}</td>
                <td>{a.scoreFailed}</td>
                <td>{(a.scoreVolume / 1e6).toFixed(2)}</td>
                <td>{a.slashEvents}</td>
                <td>{a.openJobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent Jobs ({jobs?.length ?? '…'})</h2>
      {jobs && (
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th>pubkey</th>
              <th>status</th>
              <th>amount (USDC)</th>
              <th>consumer</th>
              <th>provider</th>
              <th>createdAt</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.pubkey.toBase58()}>
                <td>{j.pubkey.toBase58().slice(0, 16)}…</td>
                <td>{j.status}</td>
                <td>{(j.amount / 1e6).toFixed(2)}</td>
                <td>{j.consumer.toBase58().slice(0, 8)}…</td>
                <td>{j.provider.toBase58().slice(0, 8)}…</td>
                <td>{new Date(j.createdAt * 1000).toISOString().slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details style={{ marginTop: 32 }}>
        <summary style={{ cursor: 'pointer', color: '#888' }}>raw JSON</summary>
        <pre style={{ fontSize: 10, maxHeight: 400, overflow: 'auto' }}>
          {JSON.stringify({ agents, jobs }, (_, v) =>
            v?.toBase58 ? v.toBase58() : v,
          2)}
        </pre>
      </details>
    </main>
  );
}
