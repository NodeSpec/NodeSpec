import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { FileText, Plus, X, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from 'lucide-react';
import { useServices } from '../../context/ServiceContext.js';
import type { SpecificationSection } from '../../services/SpecificationService.js';

interface ManualRequirementFormProps {
  specificationId: string;
  sections: SpecificationSection[];
  existingRequirementCount?: number;
  onSuccess?: (requirementId: string) => void;
  onCancel?: () => void;
}

export function ManualRequirementForm({
  specificationId,
  sections,
  existingRequirementCount = 0,
  onSuccess,
  onCancel,
}: ManualRequirementFormProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const services = useServices();

  const [requirementId, setRequirementId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'functional' | 'non-functional' | 'technical' | 'business'>('functional');
  const [priority, setPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [sectionId, setSectionId] = useState<string>('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<Array<{ text: string }>>([{ text: '' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddCriterion = () => {
    setAcceptanceCriteria([...acceptanceCriteria, { text: '' }]);
  };

  const handleRemoveCriterion = (index: number) => {
    setAcceptanceCriteria(acceptanceCriteria.filter((_, i) => i !== index));
  };

  const handleCriterionChange = (index: number, text: string) => {
    const newCriteria = [...acceptanceCriteria];
    newCriteria[index] = { text };
    setAcceptanceCriteria(newCriteria);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    const validCriteria = acceptanceCriteria.filter(c => c.text.trim() !== '');
    if (validCriteria.length === 0) {
      setError('At least one acceptance criterion is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const nextNum = existingRequirementCount + 1;
      const generatedReqId = requirementId.trim() || `REQ-${String(nextNum).padStart(3, '0')}`;

      const requirement = await services.specification.createRequirement({
        specificationId,
        requirementId: generatedReqId,
        name: name.trim(),
        description: description.trim(),
        category,
        priority,
        sectionId: sectionId || undefined,
        source: 'manual',
        acceptanceCriteria: validCriteria,
        metadata: {},
      });

      if (onSuccess) {
        onSuccess(requirement.id);
      }
    } catch (err) {
      console.error('Error creating requirement:', err);
      setError(err instanceof Error ? err.message : 'Failed to create requirement');
      setIsSubmitting(false);
    }
  };

  const containerStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: c.background,
  };

  const headerStyles: React.CSSProperties = {
    padding: '24px',
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 600,
    color: c.text,
  };

  const contentStyles: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  };

  const formGroupStyles: React.CSSProperties = {
    marginBottom: '20px',
  };

  const labelStyles: React.CSSProperties = {
    display: 'block',
    fontSize: '14px',
    fontWeight: 600,
    color: c.text,
    marginBottom: '8px',
  };

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    color: c.text,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.9)',
    border: `1px solid ${c.border}`,
    borderRadius: '6px',
    fontFamily: 'inherit',
  };

  const textareaStyles: React.CSSProperties = {
    ...inputStyles,
    minHeight: '100px',
    resize: 'vertical',
  };

  const selectStyles: React.CSSProperties = {
    ...inputStyles,
    cursor: 'pointer',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '6px',
    cursor: 'pointer',
    border: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  };

  const primaryButtonStyles: React.CSSProperties = {
    ...buttonStyles,
    backgroundColor: c.primary,
    color: '#ffffff',
  };

  const secondaryButtonStyles: React.CSSProperties = {
    ...buttonStyles,
    backgroundColor: 'transparent',
    color: c.text,
    border: `1px solid ${c.border}`,
  };

  const smallButtonStyles: React.CSSProperties = {
    ...buttonStyles,
    padding: '6px 12px',
    fontSize: '12px',
  };

  const footerStyles: React.CSSProperties = {
    padding: '16px 24px',
    borderTop: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  };

  const criterionRowStyles: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
    alignItems: 'flex-start',
  };

  return (
    <div style={containerStyles}>
      <div style={headerStyles}>
        <FileText size={24} style={{ color: c.primary }} />
        <div style={titleStyles}>Create Requirement</div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={contentStyles}>
          {error && (
            <div style={{
              padding: '12px 16px',
              marginBottom: '20px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div style={formGroupStyles}>
            <label style={labelStyles}>Requirement ID (Optional)</label>
            <input
              type="text"
              style={inputStyles}
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              placeholder="e.g., REQ-001 (auto-generated if left blank)"
            />
          </div>

          <div style={formGroupStyles}>
            <label style={labelStyles}>Name *</label>
            <input
              type="text"
              style={inputStyles}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Brief requirement title"
              required
            />
          </div>

          <div style={formGroupStyles}>
            <label style={labelStyles}>Description *</label>
            <textarea
              style={textareaStyles}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed requirement description"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyles}>Category *</label>
              <select
                style={selectStyles}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                required
              >
                <option value="functional">Functional</option>
                <option value="non-functional">Non-Functional</option>
                <option value="technical">Technical</option>
                <option value="business">Business</option>
              </select>
            </div>

            <div>
              <label style={labelStyles}>Priority *</label>
              <select
                style={selectStyles}
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                required
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div style={formGroupStyles}>
            <label style={labelStyles}>Section (Optional)</label>
            <select
              style={selectStyles}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">None</option>
              {sections.map(section => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </div>

          <div style={formGroupStyles}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <label style={{ ...labelStyles, marginBottom: 0 }}>Acceptance Criteria *</label>
              <button
                type="button"
                style={{ ...smallButtonStyles, ...secondaryButtonStyles }}
                onClick={handleAddCriterion}
              >
                <Plus size={14} />
                Add Criterion
              </button>
            </div>

            {acceptanceCriteria.map((criterion, index) => (
              <div key={index} style={criterionRowStyles}>
                <input
                  type="text"
                  style={{ ...inputStyles, flex: 1 }}
                  value={criterion.text}
                  onChange={(e) => handleCriterionChange(index, e.target.value)}
                  placeholder={`Criterion ${index + 1}`}
                />
                {acceptanceCriteria.length > 1 && (
                  <button
                    type="button"
                    style={{
                      ...buttonStyles,
                      padding: '10px',
                      backgroundColor: 'transparent',
                      color: '#ef4444',
                      border: `1px solid ${c.border}`,
                    }}
                    onClick={() => handleRemoveCriterion(index)}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={footerStyles}>
          {onCancel && (
            <button type="button" style={secondaryButtonStyles} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" style={primaryButtonStyles} disabled={isSubmitting}>
            {isSubmitting ? (
              <>Creating...</>
            ) : (
              <>
                <CheckCircle size={16} />
                Create Requirement
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
