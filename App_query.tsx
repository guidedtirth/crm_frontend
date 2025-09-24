// App_query.tsx
import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './styles.css';

interface JobData {
  title: string;
  description: string;
  skills: string[];
  budgetMin: number;
  budgetMax: number;
  profile_id?: string;
  feedback?: string;
  thread_id?: string;
}

interface ChatMessage {
  type: 'proposal' | 'feedback';
  content: string;
  profile?: string;
  score?: number;
  thread_id?: string;
  created_at?: string; // Add created_at for sorting
}

interface QueryResponse {
  result: {
    proposal: string;
    profile_name: string;
    profile_id: string;
    score: number;
    thread_id: string;
    created_at: string; // Ensure created_at is included
  };
}

interface ProposalHistory {
  id: string;
  profile_id: string;
  proposal: string;
  feedback: string | null;
  thread_id: string;
  created_at: string;
  score: number;
}

interface AppQueryProps {
  profileId: string;
  initialProposals?: ProposalHistory[];
  jobData?: JobData | null;
}

function App_query({ profileId, initialProposals = [], jobData }: AppQueryProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [feedback, setFeedback] = useState<string>('');
  const token = useMemo(() => localStorage.getItem('auth_token'), []);
  const baseUrl = useMemo(() => {
    let u = import.meta.env.VITE_API_URL as string;
    if (!u) u = 'http://localhost:3009/api/';
    if (!u.endsWith('/')) u += '/';
    return u;
  }, []);

  // Initialize chat with existing proposals and feedback in chronological order
  useEffect(() => {
    if (initialProposals.length > 0) {
      const messages: ChatMessage[] = [];

      // Sort proposals by created_at to ensure chronological order
      const sortedProposals = [...initialProposals].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      sortedProposals.forEach((entry) => {
        // Push feedback first if it exists
        if (entry.feedback) {
          messages.push({
            type: 'feedback',
            content: entry.feedback,
            created_at: entry.created_at,
          });
        }

        // Push the proposal
        messages.push({
          type: 'proposal',
          content: entry.proposal,
          profile: profileId,
          score: entry.score,
          thread_id: entry.thread_id,
          created_at: entry.created_at,
        });
      });

      console.log('Chat messages initialized:', messages);
      setChatMessages(messages);

      if (jobData && sortedProposals.length > 0) {
        // Ensure we always use the latest thread for the selected proposal history
        jobData.thread_id = sortedProposals[sortedProposals.length - 1].thread_id;
      }
    }
  }, [initialProposals, profileId, jobData]);

  const handleFeedbackSubmit = async () => {
    if (!feedback.trim()) {
      toast.error('Please enter feedback!', { position: 'top-right', autoClose: 3000 });
      return;
    }
    if (!jobData) {
      toast.error('No job data available!', { position: 'top-right', autoClose: 3000 });
      return;
    }

    if (isLoading) return;
    setIsLoading(true);

    try {
      const dataToSend = {
        ...jobData,
        profile_id: profileId,
        feedback: feedback,
        thread_id: jobData.thread_id,
      };
      console.log('Sending data to server:', dataToSend);
      const response = await axios.post<QueryResponse>(`${baseUrl}query`, { query: dataToSend }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const resultItem = (response as any)?.data?.result[0]; // Updated line

    setChatMessages([
      ...chatMessages,
      { type: 'feedback', content: feedback, created_at: new Date().toISOString() },
      {
        type: 'proposal',
        content: resultItem?.proposal, // Updated to use resultItem
        profile: resultItem?.profile_name,
        score: resultItem?.score,
        thread_id: resultItem?.thread_id,
        created_at: resultItem?.created_at,
      },
    ]);

      setFeedback('');
      toast.success('Proposal refined successfully!', { position: 'top-right', autoClose: 3000 });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string }; status?: number }; message: string };
      console.error('Feedback error:', error);
      toast.error(`Failed to refine proposal: ${error.response?.data?.error || error.message}`, {
        position: 'top-right',
        autoClose: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const chatWindow = document.querySelector('.chat-window');
    if (chatWindow) {
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <div className="query-container">
      <div className="query-card">
        <div className="query-row">
          {/* Proposal Chat Section */}
          <div className="query-full">
            <h2 className="section-title">Proposal Refinement History</h2>
            <div className="chat-window">
              {chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`chat-message ${msg.type === 'feedback' ? 'chat-message-right' : 'chat-message-left'}`}
                >
                  <div
                    className={`chat-bubble ${msg.type === 'feedback' ? 'bubble-user' : 'bubble-system'}`}
                  >
                    <div className="chat-label">
                      {msg.type === 'feedback' ? 'You' : `Proposal (Score: ${msg.score || 'N/A'})`}
                    </div>
                    <div>{msg.content}</div>
                    {msg.created_at && (
                      <div className="chat-timestamp">
                        {new Date(msg.created_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="inline-input-group">
              <input
                type="text"
                placeholder="Enter feedback to refine the proposal..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={isLoading || !jobData}
                onKeyPress={(e) => e.key === 'Enter' && handleFeedbackSubmit()}
              />
              <button
                className="button"
                onClick={handleFeedbackSubmit}
                disabled={isLoading || !jobData}
              >
                {isLoading ? 'Refining...' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App_query;