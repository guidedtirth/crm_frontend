/**
 * ChatModal.tsx
 * Profile chat UI backed by Assistants thread; supports message edit and client-side encryption.
 */
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
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      const raw = typeof (it as any).content === 'string' ? (it as any).content : JSON.stringify((it as any).content);
      const enc = await encryptWithProfile(raw);
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
          let text = '';
          if (m.content_enc && m.content_nonce) {
            const dec = await decryptWithProfile(m.content_enc, m.content_nonce);
            text = dec || '';
          }
          if (!text) text = m.content || '';
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
    if (sending || !input.trim() || !threadId) return;
    const content = input.trim();
    setInput('');

    // Optimistically render user's message immediately
    const tempId = `tmp_${Date.now()}`;
    const optimisticPayload = { text: content, images: imageDataUrls };
    const optimistic: Message = { id: tempId, role: 'user', content: JSON.stringify(optimisticPayload), created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setSending(true);
    try {
      // Build small thumbnails to include in request for server-side plaintext fallback
      const thumbsForRequest: string[] = [];
      for (const url of imageDataUrls) {
        const t = await createThumbnail(url);
        if (t) thumbsForRequest.push(t);
      }
      const resp = await fetch(`${baseUrl}chat/message/${threadId}`, {
        method: 'POST',
        headers: authHeaders.json(),
        body: JSON.stringify({ profileId, content, images: imageDataUrls, thumbs: thumbsForRequest })
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
      // Persist text plus tiny thumbnails so images re-render when reopening the chat
      const thumbs: string[] = [];
      for (const url of imageDataUrls) {
        const t = await createThumbnail(url);
        if (t) thumbs.push(t);
      }
      const userEncrypted = serverUser ? { ...serverUser, content: { text: content, images: thumbs } } : { id: tempId, role: 'user', content: { text: content, images: thumbs }, created_at: new Date().toISOString() };
      await saveEncryptedBatch(threadId, [
        userEncrypted as any,
        ...(serverAssistant ? [serverAssistant] : [])
      ] as any);
      // Clear selected images after successful send
      setImageDataUrls([]);
    } catch (e) {
      // Revert optimistic user message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function handleImagesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr: string[] = [...imageDataUrls];
    const max = 6; // allow up to 6 thumbnails
    const take = Math.min(files.length, Math.max(0, max - arr.length));
    for (let i = 0; i < take; i++) {
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(f);
      });
      arr.push(url);
    }
    setImageDataUrls(arr);
  }

  function triggerFilePicker() {
    try { fileInputRef.current?.click(); } catch {}
  }

  async function createThumbnail(dataUrl: string, maxW = 200, maxH = 200): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img as any;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        const w = Math.max(1, Math.floor(width * ratio));
        const h = Math.max(1, Math.floor(height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0, w, h);
        // Use JPEG for better compression; fall back to PNG if data URL already png
        const isPng = dataUrl.startsWith('data:image/png');
        const out = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.72);
        resolve(out);
      };
      img.onerror = () => resolve('');
      img.src = dataUrl;
    });
  }

  function parseContent(raw: string): { text: string; images: string[] } {
    try {
      const obj = JSON.parse(raw);
      const text = (obj && typeof obj.text === 'string') ? obj.text : (typeof obj === 'string' ? obj : '');
      const images = Array.isArray(obj?.images) ? obj.images.filter((u: any) => typeof u === 'string' && u.trim()) : [];
      if (images.length || (obj && typeof obj.text === 'string')) return { text, images };
      return { text: raw, images: [] };
    } catch {
      return { text: raw, images: [] };
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
          {messages.map(m => {
            const parsed = parseContent(m.content || '');
            return (
            <div key={m.id} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: 12, background: m.role === 'user' ? '#2563eb' : '#1f2937', color: '#fff' }}>
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
                            let text = '';
                            if (row.content_enc && row.content_nonce) {
                              const dec = await decryptWithProfile(row.content_enc, row.content_nonce);
                              text = dec || '';
                            }
                            if (!text) text = row.content || '';
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
                          let text = '';
                          if (row.content_enc && row.content_nonce) {
                            const dec = await decryptWithProfile(row.content_enc, row.content_nonce);
                            text = dec || '';
                          }
                          if (!text) text = row.content || '';
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {parsed.images && parsed.images.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                        {parsed.images.map((url, idx) => (
                          <div key={`${m.id}_img_${idx}`} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#0b1020' }}>
                            <img src={url} alt="attachment" style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }} />
                          </div>
                        ))}
                      </div>
                    )}
                    {parsed.text && (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{parsed.text}</span>
                    )}
                    {m.role === 'user' && !String(m.id).startsWith('tmp_') && (parsed.images?.length ? false : true) && (
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
          );})}
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
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 24, padding: '6px 8px', paddingTop: imageDataUrls.length > 0 ? 42 : 6, flex: 1, border: '1px solid #e5e7eb' }}>
            {/* thumbnails row */}
            {imageDataUrls.length > 0 && (
              <div style={{ position: 'absolute', top: 6, left: 54, right: 54, display: 'flex', gap: 6, alignItems: 'center' }}>
                {imageDataUrls.map((url, idx) => (
                  <div key={`thumb_${idx}`} style={{ position: 'relative', width: 28, height: 28, borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f8fafc' }}>
                    <img src={url} alt={`thumb_${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button
                      className="button button-outline"
                      title="Remove"
                      onClick={() => setImageDataUrls(prev => prev.filter((_, i) => i !== idx))}
                      style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="button button-outline"
              title="Attach image(s)"
              onClick={triggerFilePicker}
              aria-label="Attach image"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, padding: 0, background: 'transparent', border: 'none', color: '#6b7280' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.5"/><path d="M14 2v6h6"/><path d="M10 20l-3.5-4.5L4 18"/><path d="M20 20l-6-8-4.5 6"/></svg>
            </button>
            <textarea
              className="input"
              placeholder="Type your message... (Shift+Enter for newline)"
              style={{ width: '100%', minHeight: 40, resize: 'vertical', lineHeight: 1.4, background: 'transparent', border: 'none', color: '#111' }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) send(); } }}
            />
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => handleImagesSelected(e.target.files)} style={{ display: 'none' }} />
            {/* inline send/stop icon */}
            <button className="button" title={sending ? 'Stop' : 'Send'} disabled={!threadId || sending || !input.trim()} onClick={send} style={{ width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 'none', color: '#6b7280' }}>
              {sending ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9 22 2"/></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}


