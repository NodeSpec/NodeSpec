import { memo, useState, useCallback } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import type { AIInputContext, SelectedContext } from '@nodespec/core/ai-proposal.js';
import {
  buildAIInputContext,
  formatAIInputForPrompt,
  DEFAULT_HARD_RULES,
} from '@nodespec/core/ai-proposal.js';

const buttonStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 16px',
  backgroundColor: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 150ms ease',
};

const disabledButtonStyles: React.CSSProperties = {
  ...buttonStyles,
  backgroundColor: '#1e40af',
  cursor: 'not-allowed',
  opacity: 0.6,
};

const modalOverlayStyles: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyles: React.CSSProperties = {
  backgroundColor: '#1e293b',
  borderRadius: '12px',
  width: '600px',
  maxHeight: '80vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const modalHeaderStyles: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid #334155',
};

const modalTitleStyles: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#f1f5f9',
  marginBottom: '8px',
};

const modalSubtitleStyles: React.CSSProperties = {
  fontSize: '13px',
  color: '#94a3b8',
};

const modalContentStyles: React.CSSProperties = {
  padding: '24px',
  overflow: 'auto',
  flex: 1,
};

const textareaStyles: React.CSSProperties = {
  width: '100%',
  minHeight: '120px',
  padding: '12px',
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '6px',
  color: '#f1f5f9',
  fontSize: '13px',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const labelStyles: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#94a3b8',
  marginBottom: '8px',
};

const sectionStyles: React.CSSProperties = {
  marginBottom: '20px',
};

const previewStyles: React.CSSProperties = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '6px',
  padding: '12px',
  maxHeight: '200px',
  overflow: 'auto',
  fontFamily: 'monospace',
  fontSize: '11px',
  color: '#94a3b8',
  whiteSpace: 'pre-wrap',
};

const modalFooterStyles: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid #334155',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
};

const secondaryButtonStyles: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: '#334155',
  color: '#f1f5f9',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const primaryButtonStyles: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: '#22c55e',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

interface AIProposalButtonProps {
  graph: Graph;
  selectedContext?: SelectedContext;
  onRequestProposal?: (context: AIInputContext, userPrompt: string) => void;
  disabled?: boolean;
}

function AIProposalButtonComponent({
  graph,
  selectedContext,
  onRequestProposal,
  disabled = false,
}: AIProposalButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [customRules, setCustomRules] = useState('');

  const handleOpen = useCallback(() => {
    if (!disabled) {
      setIsOpen(true);
    }
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setUserPrompt('');
    setCustomRules('');
  }, []);

  const aiContext = buildAIInputContext(
    graph,
    selectedContext,
    customRules
      ? [...DEFAULT_HARD_RULES, ...customRules.split('\n').filter((r) => r.trim())]
      : DEFAULT_HARD_RULES
  );

  const formattedPrompt = formatAIInputForPrompt(aiContext);

  const handleSubmit = useCallback(() => {
    if (userPrompt.trim()) {
      onRequestProposal?.(aiContext, userPrompt.trim());
      handleClose();
    }
  }, [aiContext, userPrompt, onRequestProposal, handleClose]);

  return (
    <>
      <button
        style={disabled ? disabledButtonStyles : buttonStyles}
        onClick={handleOpen}
        disabled={disabled}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
        AI Propose
      </button>

      {isOpen && (
        <div style={modalOverlayStyles} onClick={handleClose}>
          <div style={modalStyles} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyles}>
              <div style={modalTitleStyles}>Request AI Proposal</div>
              <div style={modalSubtitleStyles}>
                Describe what changes you want the AI to propose
              </div>
            </div>

            <div style={modalContentStyles}>
              <div style={sectionStyles}>
                <label style={labelStyles}>What would you like the AI to do?</label>
                <textarea
                  style={textareaStyles}
                  placeholder="e.g., Add a caching layer between the API Gateway and User Service..."
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                />
              </div>

              <div style={sectionStyles}>
                <label style={labelStyles}>Additional Rules (optional)</label>
                <textarea
                  style={{ ...textareaStyles, minHeight: '80px' }}
                  placeholder="One rule per line..."
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                />
              </div>

              <div style={sectionStyles}>
                <label style={labelStyles}>Context Preview (sent to AI)</label>
                <pre style={previewStyles}>{formattedPrompt}</pre>
              </div>
            </div>

            <div style={modalFooterStyles}>
              <button style={secondaryButtonStyles} onClick={handleClose}>
                Cancel
              </button>
              <button
                style={primaryButtonStyles}
                onClick={handleSubmit}
                disabled={!userPrompt.trim()}
              >
                Generate Proposal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const AIProposalButton = memo(AIProposalButtonComponent);
