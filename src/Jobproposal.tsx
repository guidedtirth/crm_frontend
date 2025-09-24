// JobProposal.tsx
import { useState, useEffect } from 'react';
import Tooltip from '@mui/material/Tooltip';
import AppQuery from '../AppQuery';

interface ProposalHistoryItem {
  id: string;
  profile_id: string;
  query_text: any;
  feedback: string | null;
  proposal: string;
  thread_id: string;
  created_at: string;
  score: number;
}

interface JobProposalProps {
  jobData: {
    proposal: string;
    id: string;
    title: string;
    thread_id: string;
    query_text: any;
  };
  onClose: () => void;
  profileId: string;
  proposalHistory: ProposalHistoryItem[];
}

const JobProposal = ({ jobData, onClose, profileId, proposalHistory }: JobProposalProps) => {
  const [selectedVersion, setSelectedVersion] = useState<ProposalHistoryItem | null>(null);
  console.log('JobProposal jobData:', jobData);
  console.log('JobProposal proposalHistory:', proposalHistory);

  // Set the initial selected version to the latest proposal
  useEffect(() => {
    if (proposalHistory.length > 0) {
      const latestVersion = proposalHistory.reduce((latest, current) =>
        new Date(current.created_at) > new Date(latest.created_at) ? current : latest
      );
      setSelectedVersion(latestVersion);
    }
  }, [proposalHistory]);

  const handleRedirect = () => {
    const url = `https://www.upwork.com/jobs/abc_~02${jobData?.id}`;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  };

  // Extract job data for AppQuery
  const getJobData = () => {
    if (!selectedVersion) return null;

    try {
      const queryText = selectedVersion.query_text;
      return {
        title: queryText,
        description: '',
        skills: [],
        budgetMin: queryText.hourlyBudgetMin?.rawValue || queryText.amount?.rawValue || 0,
        budgetMax: queryText.hourlyBudgetMax?.rawValue || queryText.amount?.rawValue || 0,
        thread_id: selectedVersion.thread_id,
      };
    } catch (error) {
      console.error('Error parsing job data:', error);
      return null;
    }
  };

  return (
    <div className="job-proposal-container">
      <div className="job-proposal-header">
        <div className="title-container">
          <Tooltip title={jobData.title} placement="top" arrow>
            <h3>{jobData.title}</h3>
          </Tooltip>

          {jobData?.id && (
            <button className="redirect-button" onClick={handleRedirect} title="Open job on Upwork">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          )}
        </div>
        <button className="close-button" onClick={onClose}>
          ×
        </button>
      </div>

      {/* Current proposal display */}
      <div className="job-description">
        <h4>Selected Proposal:</h4>
        <p>{selectedVersion?.proposal || 'No proposal selected'}</p>
      </div>

      {/* Proposal refinement section */}
      {selectedVersion && (
        <div className="proposal-refinement">
          <h4>Refine This Proposal:</h4>
          <AppQuery
            key={selectedVersion?.thread_id || jobData.thread_id}
            profileId={profileId}
            initialProposals={proposalHistory}
            jobData={getJobData()}
          />
        </div>
      )}
    </div>
  );
};

export default JobProposal;
