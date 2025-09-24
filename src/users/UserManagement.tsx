import { useEffect, useMemo, useState } from 'react';
import './userManagement.css';
import ChatModal from '../components/ChatModal';
import FiltersModal from '../components/FiltersModal';

interface User {
  id: string;
  name: string;
}

interface TrainingDialogProps {
  userId: string;
  username: string;
  onUpload: (userId: string, file: File) => void;
}

function TrainingDialog({ userId, username, onUpload }: TrainingDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      console.log('Please select a file.');
      return;
    }

    setIsUploading(true);
    try {
      await onUpload(userId, file);
      setOpen(false);
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  return (
    <div className="dialog-wrapper">
      <button
        className="button button-outline"
        title="Train user"
        onClick={() => setOpen(true)}
      >
        <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      </button>
      {open && (
        <div className="dialog-overlay">
          <div className="dialog-content">
            <div className="dialog-header">
              <h3 className="dialog-title">Train User: {username}</h3>
              <button
                className="button button-close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleUpload} className="form-spacing">
              <div className="grid-container">
                <div className="flex-container flex-1">
                  <input
                    id="file"
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="input input-file"
                  />
                </div>
              </div>
              <div className="flex-end">
                <button
                  type="submit"
                  disabled={isUploading || !file}
                  className="button"
                >
                  {isUploading ? 'Uploading...' : 'Upload File'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserManagement() {
  console.log('UserManagement component loaded',import.meta.env.VITE_API_URL);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [chatProfileId, setChatProfileId] = useState<string | null>(null);
  const [filtersScope, setFiltersScope] = useState<{ scope: 'company'|'profile'; profileId?: string|null } | null>(null);

  const token = useMemo(() => localStorage.getItem('auth_token'), []);
  const baseUrl = useMemo(() => {
    let u = import.meta.env.VITE_API_URL as string;
    if (!u) u = 'http://localhost:3009/api/';
    if (!u.endsWith('/')) u += '/';
    return u;
  }, []);
  const authHeaders = useMemo(() => ({
    json: () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
    bearer: () => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}) })
  }), [token]);

  const getAllUsers = async () => {
    try {
      const response = await fetch(`${baseUrl}profiles`, { headers: authHeaders.bearer() });
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      console.log('Fetched users:', data);
      const formattedUsers = data.map((user: any) => ({
        id: user.id,
        name: user.name,
      }));
      setUsers(formattedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  useEffect(() => {
    getAllUsers();
  }, []);


  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }
    setUsernameError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${baseUrl}profiles`, {
        method: 'POST',
        headers: authHeaders.json(),
        body: JSON.stringify({ name: username }),
      });

      if (!response.ok) {
        throw new Error('Failed to create user');
      }

      await getAllUsers();
      setUsername('');
      setCreateDialogOpen(false);
    } catch (error) {
      console.error('User creation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableTraining = async (userId: string) => {
    try {
      const response = await fetch(`${baseUrl}profiles/disable-training/${userId}`, {
        method: 'PUT',
        headers: authHeaders.bearer(),
      });

      if (!response.ok) {
        throw new Error('Failed to disable training for user');
      }
      // Optionally refresh user data if needed
      // await getAllUsers();
    } catch (error) {
      console.error('Error disabling training:', error);
    }
  };


  const handleDeleteUser = async (id: string) => {
    try {
      const response = await fetch(`${baseUrl}profiles/${id}`, {
        method: 'DELETE',
        headers: authHeaders.bearer(),
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }
      setUsers(users.filter((user) => user.id !== id));
    } catch (error) {
      console.error('User deletion error:', error);
    }
  };

  const handleTrainingUpload = async (userId: string, file: File) => {
    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch(`${baseUrl}train/${userId}`, {
        method: 'POST',
        headers: authHeaders.bearer(),
        body: formData,
      });

      if (!response.ok) throw new Error('Training API failed');
    } catch (error) {
      console.error('Training Upload Error:', error);
    }
  };

  return (
    <div className="container container-spacing">
      <div className="flex-container flex-row">
        <div className="flex-container">
          <h1 className="title">User Management</h1>
        </div>
        <div className="flex-end" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="key-toolbar">
          <button
            className="button button-outline button-sm"
            onClick={async () => {
              const te = new TextEncoder();
              function b64e(buf: ArrayBuffer | Uint8Array){ const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s=''; for(let i=0;i<arr.length;i++) s+=String.fromCharCode(arr[i]); return btoa(s);} 
              function b64d(b64: string){ const s=atob(b64); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; }
              let keyB64 = localStorage.getItem('chat_master_key');
              if (!keyB64) { const raw=new Uint8Array(32); crypto.getRandomValues(raw); keyB64=b64e(raw); localStorage.setItem('chat_master_key', keyB64); }
              const pass = prompt('Set a passphrase to protect your backup:'); if (!pass) return;
              const salt = crypto.getRandomValues(new Uint8Array(16));
              const pbk = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
              const wrapKey = await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, pbk, { name:'AES-GCM', length:256 }, false, ['encrypt']);
              const iv = crypto.getRandomValues(new Uint8Array(12));
              const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, wrapKey, b64d(keyB64));
              const cid = localStorage.getItem('company_id') || null;
              const blob = new Blob([JSON.stringify({ v:1, cid, salt:b64e(salt), iv:b64e(iv), data:b64e(ct) })], { type:'application/json' });
              const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='chat-key-backup.json'; a.click();
            }}
          >Export Key</button>
          <button
            className="button button-outline button-sm"
            onClick={async () => {
              const te = new TextEncoder();
              function b64e(buf: ArrayBuffer | Uint8Array){ const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s=''; for(let i=0;i<arr.length;i++) s+=String.fromCharCode(arr[i]); return btoa(s);} 
              function b64d(b64: string){ const s=atob(b64); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; }
              const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
              inp.onchange=async()=>{
                const f=inp.files?.[0]; if(!f) return; const text=await f.text(); const obj=JSON.parse(text);
                const pass=prompt('Enter passphrase to unlock your key:'); if(!pass) return;
                try{
                  const salt=b64d(obj.salt); const iv=b64d(obj.iv); const data=b64d(obj.data);
                  const pbk=await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
                  const unwrap=await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, pbk, { name:'AES-GCM', length:256 }, false, ['decrypt']);
                  const raw=await crypto.subtle.decrypt({ name:'AES-GCM', iv }, unwrap, data);
                  const keyB64=b64e(raw);
                  const currentCid = localStorage.getItem('company_id') || null;
                  const backupCid = obj.cid || null;
                  if (backupCid && currentCid && backupCid !== currentCid) {
                    alert('Backup key belongs to a different company and cannot decrypt current chats.');
                    return;
                  }
                  localStorage.setItem('chat_master_key', keyB64); alert('Key imported successfully');
                }catch{ alert('Invalid backup or passphrase'); }
              };
              inp.click();
            }}
          >Import Key</button>
          <button
            className="button button-outline button-sm"
            onClick={() => setFiltersScope({ scope: 'company' })}
          >Default Filters</button>
          </div>
          <button
            className="button"
            onClick={() => setCreateDialogOpen(true)}
          >
            <svg className="icon-sm icon-margin-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" />
              <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="10" y1="10" x2="14" y2="10" />
            </svg>
            Create User
          </button>
        </div>
      </div>

      {createDialogOpen && (
        <div className="dialog-overlay">
          <div className="dialog-content">
            <div className="dialog-header">
              <h3 className="dialog-title">Create New User</h3>
              <button
                className="button button-close"
                onClick={() => setCreateDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="form-spacing">
              <div className="form-group">
                <label htmlFor="username" className="form-label">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="johndoe"
                  disabled={isLoading}
                  className="input"
                />
                {usernameError && <span className="form-error">{usernameError}</span>}
              </div>
              <button
                type="submit"
                className="button button-full"
                disabled={isLoading}
              >
                {isLoading ? 'Creating user...' : 'Create User'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-content">
          {users.length > 0 ? (
            <table className="table">
              <thead className="table-header">
                <tr className="table-row">
                  <th className="table-head">Username</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="table-row">
                    <td className="table-cell text-medium">{user.name}</td>
                    <td className="table-cell text-right">
                      <div className="flex-rows flex-end actions-spacing">
                        <div className="hidden">
                          <TrainingDialog
                            userId={user.id}
                            username={user.name}
                            onUpload={handleTrainingUpload}
                          />
                        </div>
                        <button
                          className="button button-outline"
                          title="Filters"
                          onClick={() => setFiltersScope({ scope: 'profile', profileId: user.id })}
                        >Filters</button>
                        <button
                          className="button button-outline"
                          title="Chat"
                          onClick={() => setChatProfileId(user.id)}
                        >
                          Chat
                        </button>
                        <div className="dialog-wrapper">
                          <button
                            className="button button-outline button-error"
                            title="Delete user"
                            onClick={() => setUserToDelete(user.id)}
                          >
                            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                          

                          {userToDelete === user.id && (
                            <div className="dialog-overlay">
                              <div className="alert-dialog-content">
                                <div className="alert-dialog-header">
                                  <h3 className="alert-dialog-title">Are you sure?</h3>
                                </div>
                                <p className="alert-dialog-description">
                                  This action cannot be undone. This will permanently delete the user
                                  and remove their data from our servers.
                                </p>
                                <div className="alert-dialog-footer">
                                  <button
                                    className="button"
                                    onClick={() => setUserToDelete(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="button button-error-bg"
                                    onClick={() => {
                                      handleDeleteUser(userToDelete);
                                      setUserToDelete(null);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="hidden">
                          <button
                              className="button button-outline button-warning"
                              title="Disable training"
                              onClick={() => handleDisableTraining(user.id)}
                            >
                              <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10 15l-3.5-3.5 1.41-1.41L10 12.17l5.09-5.09L16.5 8.5z" />
                                <line x1="2" y1="2" x2="22" y2="22" stroke="red" />
                              </svg>
                            </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex-container text-center empty-state">
              <svg className="icon-lg icon-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12c2.21 0 4-1.79 4-4s-1.79-4 4-4-4 1.79-4 4 1.79 4 4z" />
                <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="10" y1="10" x2="14" y2="10" />
              </svg>
              <h3 className="text-lg">No users found</h3>
              <p className="text-sm subtitle">Create a user to get started</p>
            </div>
          )}
        </div>
      </div>
      {chatProfileId && (
        <ChatModal profileId={chatProfileId} onClose={() => setChatProfileId(null)} />
      )}
      {filtersScope && (
        <FiltersModal scope={filtersScope.scope} profileId={filtersScope.profileId || null} onClose={() => setFiltersScope(null)} />
      )}
    </div>
  );
}