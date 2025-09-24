import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CircularProgress from '@mui/material/CircularProgress';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
};

interface ChatModalProps {
  profileId: string;
  onClose: () => void;
}

export default function ChatModal({ profileId, onClose }: ChatModalProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [, setMk] = useState<string | null>(null); // store-only, no reads needed

  const baseUrl = useMemo(() => {
    let u = import.meta.env.VITE_API_URL as string;
    if (!u) u = 'http://localhost:3009/api/';
    if (!u.endsWith('/')) u += '/';
    return u;
  }, []);
  const token = useMemo(() => localStorage.getItem('auth_token'), []);
  const companyId = useMemo(() => localStorage.getItem('company_id'), []);
  const authHeaders = useMemo(() => ({
    json: () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
    bearer: () => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}) })
  }), [token]);

  // ---- Client-side crypto helpers ----
  const te = new TextEncoder();
  const td = new TextDecoder();
  function b64e(buf: ArrayBuffer | Uint8Array) {
    const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
    return btoa(str);
  }
  function b64d(b64: string) {
    const str = atob(b64);
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    return arr;
  }
  async function ensureMasterKey() {
    // If logged out or company changed, there should be no usable key
    if (!companyId) return null as any;
    let keyB64 = localStorage.getItem('chat_master_key');
    if (!keyB64) {
      const raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      keyB64 = b64e(raw);
      localStorage.setItem('chat_master_key', keyB64);
    }
    setMk(keyB64);
    return keyB64;
  }
  async function deriveProfileKey(masterB64: string, pid: string) {
    const raw = b64d(masterB64);
    const baseKey = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const salt = te.encode('mk_salt_v1');
    const info = te.encode(`company:${companyId || 'default'}|profile:${pid}`);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
  }
  async function encryptWithProfile(text: string) {
    const keyB64 = await ensureMasterKey();
    const key = await deriveProfileKey(keyB64, profileId);
    const iv = new Uint8Array(12); crypto.getRandomValues(iv);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
    return { content_enc: b64e(ct), content_nonce: b64e(iv), content_salt: b64e(te.encode('mk_salt_v1')) };
  }
  async function decryptWithProfile(content_enc?: string, content_nonce?: string) {
    if (!content_enc || !content_nonce) return null;
    const keyB64 = await ensureMasterKey();
    const key = await deriveProfileKey(keyB64, profileId);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(content_nonce) }, key, b64d(content_enc));
      return td.decode(pt);
    } catch {
      return null;
    }
  }
  async function saveEncryptedBatch(thread: string, items: Array<{ id: string; role: string; content: string; created_at?: string }>) {
    if (!items || !items.length) return;
    const payload: any[] = [];
    for (const it of items) {
      const enc = await encryptWithProfile(it.content);
      payload.push({ id: it.id, profile_id: profileId, thread_id: thread, role: it.role, content_enc: enc.content_enc, content_nonce: enc.content_nonce, content_salt: enc.content_salt, created_at: it.created_at });
    }
    try { await fetch(`${baseUrl}chat/encrypted/${thread}`, { method: 'POST', headers: authHeaders.json(), body: JSON.stringify({ items: payload }) }); } catch {}
  }

  useEffect(() => {
    (async () => {
      await ensureMasterKey();
      // try to fetch existing history
      const hist = await fetch(`${baseUrl}chat/history/${profileId}`, { headers: authHeaders.bearer() }).then(r => r.json());
      if (hist?.thread_id) {
        setThreadId(hist.thread_id);
        const rows = (hist.messages || []) as any[];
        const mapped: Message[] = [];
        for (const m of rows) {
          let text = m.content || '';
          if (!text && (m.content_enc && m.content_nonce)) {
            const dec = await decryptWithProfile(m.content_enc, m.content_nonce);
            text = dec || '';
          }
          mapped.push({ id: m.id, role: m.role, content: text, created_at: m.created_at });
        }
        setMessages(mapped);
      } else {
        // start a new thread
        const started = await fetch(`${baseUrl}chat/start/${profileId}`, { method: 'POST', headers: authHeaders.json() }).then(r => r.json());
        setThreadId(started.thread_id);
      }
    })();
  }, [baseUrl, profileId, authHeaders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    if (!input.trim() || !threadId) return;
    const content = input.trim();
    setInput('');

    // Optimistically render user's message immediately
    const tempId = `tmp_${Date.now()}`;
    const optimistic: Message = { id: tempId, role: 'user', content, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setSending(true);
    try {
      const resp = await fetch(`${baseUrl}chat/message/${threadId}`, {
        method: 'POST',
        headers: authHeaders.json(),
        body: JSON.stringify({ profileId, content })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Send failed');
      const newMsgs: Message[] = data.messages || [];
      // Replace optimistic temp message with server's persisted user message (has UUID), then append assistant
      const serverUser = newMsgs.find(m => m.role === 'user');
      const serverAssistant = newMsgs.find(m => m.role === 'assistant');
      setMessages(prev => {
        let next = prev.map(m => (m.id === tempId && serverUser ? serverUser : m));
        if (serverAssistant) next = [...next, serverAssistant];
        return next;
      });
      // Save encrypted copies
      await saveEncryptedBatch(threadId, [
        serverUser ? serverUser : { id: tempId, role: 'user', content, created_at: new Date().toISOString() },
        ...(serverAssistant ? [serverAssistant] : [])
      ] as any);
    } catch (e) {
      // Revert optimistic user message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="dialog-overlay" style={{ zIndex: 1100 }}>
      <div className="dialog-content dialog-large" style={{ display: 'flex', flexDirection: 'column', height: '86vh', width: '100%', maxWidth: 1000 }}>
        <div className="dialog-header">
          <h3 className="dialog-title" style={{ fontSize: 18, fontWeight: 700 }}>Chat</h3>
          <button className="button button-close" onClick={onClose} aria-label="Close chat">×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#0f172a0d', borderRadius: 12 }}>
          {messages.map(m => (
            <div key={m.id} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: 8, background: m.role === 'user' ? '#2563eb' : '#1f2937', color: '#fff', whiteSpace: 'pre-wrap' }}>
                {editingId === m.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', width: '100%' }}>
                    <textarea
                      className="input"
                      style={{ width: '100%', minHeight: 120, background: '#0b1020', color: '#fff', resize: 'vertical', lineHeight: 1.4 }}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder="Edit message..."
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { (async () => {
                        if (!threadId) return;
                        // Optimistically update edited message and truncate following messages
                        setSending(true);
                        setMessages(prev => {
                          const index = prev.findIndex(x => x.id === m.id);
                          if (index === -1) return prev;
                          const updated = [...prev];
                          updated[index] = { ...updated[index], content: editText };
                          return updated.slice(0, index + 1);
                        });
                        const resp = await fetch(`${baseUrl}chat/message/${m.id}`, {
                          method: 'PUT',
                          headers: authHeaders.json(),
                          body: JSON.stringify({ profileId, content: editText })
                        });
                        const data = await resp.json();
                        if (!resp.ok) { alert(data?.error || 'Failed to edit'); return; }
                        {
                          const raw = (data.messages || []) as any[];
                          const display: Message[] = [];
                          for (const row of raw) {
                            let text = row.content || '';
                            if (!text && (row.content_enc && row.content_nonce)) {
                              const dec = await decryptWithProfile(row.content_enc, row.content_nonce);
                              text = dec || '';
                            }
                            // Fallback to previously rendered content for legacy rows without data
                            if (!text) {
                              const prev = messages.find((p) => p.id === row.id);
                              if (prev?.content) text = prev.content;
                            }
                            display.push({ id: row.id, role: row.role, content: text, created_at: row.created_at });
                          }
                          setMessages(display);
                          // Save encrypted copies for edited user message and new assistant reply only
                          const lastTwo = raw.slice(-2).map((r: any) => ({ id: r.id, role: r.role, content: display.find(d => d.id === r.id)?.content || '', created_at: r.created_at }));
                          await saveEncryptedBatch(data.thread_id || threadId, lastTwo as any);
                        }
                        setEditingId(null);
                        setEditText('');
                        setThreadId(data.thread_id || threadId);
                        setSending(false);
                      })(); } }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="button" title="Save (Ctrl/Cmd+Enter)" onClick={async () => {
                      if (!threadId) return;
                      // Optimistic update before request
                      setSending(true);
                      setMessages(prev => {
                        const index = prev.findIndex(x => x.id === m.id);
                        if (index === -1) return prev;
                        const updated = [...prev];
                        updated[index] = { ...updated[index], content: editText };
                        return updated.slice(0, index + 1);
                      });
                      const resp = await fetch(`${baseUrl}chat/message/${m.id}`, {
                        method: 'PUT',
                        headers: authHeaders.json(),
                        body: JSON.stringify({ profileId, content: editText })
                      });
                      const data = await resp.json();
                      if (!resp.ok) { alert(data?.error || 'Failed to edit'); return; }
                      {
                        const raw = (data.messages || []) as any[];
                        const display: Message[] = [];
                        for (const row of raw) {
                          let text = row.content || '';
                          if (!text && (row.content_enc && row.content_nonce)) {
                            const dec = await decryptWithProfile(row.content_enc, row.content_nonce);
                            text = dec || '';
                          }
                          if (!text) {
                            const prev = messages.find((p) => p.id === row.id);
                            if (prev?.content) text = prev.content;
                          }
                          display.push({ id: row.id, role: row.role, content: text, created_at: row.created_at });
                        }
                        setMessages(display);
                        const lastTwo = raw.slice(-2).map((r: any) => ({ id: r.id, role: r.role, content: display.find(d => d.id === r.id)?.content || '', created_at: r.created_at }));
                        await saveEncryptedBatch(data.thread_id || threadId, lastTwo as any);
                      }
                      setEditingId(null);
                      setEditText('');
                      setThreadId(data.thread_id || threadId);
                      setSending(false);
                    }}> 
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button className="button button-outline" title="Cancel" onClick={() => { setEditingId(null); setEditText(''); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>{m.content}</span>
                    {m.role === 'user' && !String(m.id).startsWith('tmp_') && (
                      <button
                        className="button button-outline"
                        onClick={() => { setEditingId(m.id); setEditText(m.content); }}
                        title="Edit"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: 8, background: '#1f2937', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CircularProgress size={16} color="inherit" />
                <span>Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <textarea
            className="input"
            placeholder="Type your message... (Shift+Enter for newline)"
            style={{ width: '100%', minHeight: 60, resize: 'vertical', lineHeight: 1.4 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="button" style={{ minWidth: 90 }} disabled={!threadId || sending || !input.trim()} onClick={send}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


