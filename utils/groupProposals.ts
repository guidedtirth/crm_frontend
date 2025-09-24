// utils/groupProposals.ts
export const groupProposalsByThread = (proposals: any[]) => {
  const grouped: Record<string, any[]> = {};
  
  proposals.forEach(proposal => {
    if (!grouped[proposal.thread_id]) {
      grouped[proposal.thread_id] = [];
    }
    grouped[proposal.thread_id].push(proposal);
  });
  
  return grouped;
};