/**
 * Status Message Utilities
 *
 * Transforms technical workflow progress into natural, conversational status messages
 */

import type { ClassifiedIntent } from '@nodespec/core/ai-orchestration';

interface StatusMessageConfig {
  thinking: string;
  working: string;
  finalizing: string;
}

/**
 * Maps intent to user-friendly status messages
 */
export function getStatusMessages(intent: ClassifiedIntent): StatusMessageConfig {
  const { category, action } = intent;

  // Architecture-related intents
  if (category === 'architecture') {
    if (action === 'create' || action === 'generate') {
      return {
        thinking: 'Analyzing requirements...',
        working: 'Designing system architecture...',
        finalizing: 'Finalizing architecture...',
      };
    }
    if (action === 'refine' || action === 'update') {
      return {
        thinking: 'Understanding changes...',
        working: 'Refining architecture...',
        finalizing: 'Applying refinements...',
      };
    }
  }

  // Features-related intents
  if (category === 'features') {
    if (action === 'create' || action === 'generate') {
      return {
        thinking: 'Understanding requirements...',
        working: 'Creating feature definitions...',
        finalizing: 'Organizing features...',
      };
    }
    if (action === 'refine') {
      return {
        thinking: 'Reviewing features...',
        working: 'Enhancing feature details...',
        finalizing: 'Updating features...',
      };
    }
  }

  // Specification-related intents
  if (category === 'specification') {
    return {
      thinking: 'Processing your vision...',
      working: 'Generating specification...',
      finalizing: 'Structuring requirements...',
    };
  }

  // Requirements-related intents
  if (category === 'requirements') {
    if (action === 'create' || action === 'generate') {
      return {
        thinking: 'Analyzing needs...',
        working: 'Defining requirements...',
        finalizing: 'Organizing requirements...',
      };
    }
    if (action === 'refine') {
      return {
        thinking: 'Reviewing requirements...',
        working: 'Clarifying details...',
        finalizing: 'Updating requirements...',
      };
    }
  }

  // Artifacts-related intents
  if (category === 'artifacts') {
    return {
      thinking: 'Preparing to generate code...',
      working: 'Creating implementation files...',
      finalizing: 'Organizing artifacts...',
    };
  }

  // Analysis intents
  if (category === 'analysis') {
    return {
      thinking: 'Analyzing your project...',
      working: 'Gathering insights...',
      finalizing: 'Preparing summary...',
    };
  }

  // Validation intents
  if (category === 'validation') {
    return {
      thinking: 'Reviewing implementation...',
      working: 'Validating against requirements...',
      finalizing: 'Generating validation report...',
    };
  }

  // Traceability intents
  if (category === 'traceability') {
    return {
      thinking: 'Analyzing connections...',
      working: 'Tracing requirements to implementation...',
      finalizing: 'Building traceability map...',
    };
  }

  // Mapping intents
  if (category === 'mapping') {
    return {
      thinking: 'Understanding relationships...',
      working: 'Creating mappings...',
      finalizing: 'Linking components...',
    };
  }

  // Incremental changes
  if (category === 'incremental') {
    return {
      thinking: 'Analyzing additions...',
      working: 'Integrating new elements...',
      finalizing: 'Updating project...',
    };
  }

  // Refinement (catch-all for improvements)
  if (category === 'refinement') {
    return {
      thinking: 'Understanding improvements...',
      working: 'Making refinements...',
      finalizing: 'Applying changes...',
    };
  }

  // Default fallback
  return {
    thinking: 'Processing your request...',
    working: 'Working on it...',
    finalizing: 'Almost done...',
  };
}

/**
 * Status message manager for smooth transitions
 */
export class StatusMessageManager {
  private currentMessage: string = '';
  private messageStartTime: number = 0;
  private minDisplayTime: number = 1500; // Minimum 1.5s per message
  private lastUpdate: number = 0;
  private updateThrottle: number = 500; // Max one update per 500ms

  /**
   * Check if we should update the status (respects throttling)
   */
  shouldUpdate(): boolean {
    const now = Date.now();
    return now - this.lastUpdate >= this.updateThrottle;
  }

  /**
   * Set a new status message (with throttling)
   */
  setMessage(message: string): string | null {
    const now = Date.now();

    // Skip if same message
    if (message === this.currentMessage) {
      return null;
    }

    // Respect minimum display time for previous message
    if (this.messageStartTime > 0 && now - this.messageStartTime < this.minDisplayTime) {
      return null; // Don't update yet
    }

    // Throttle rapid updates
    if (!this.shouldUpdate()) {
      return null;
    }

    this.currentMessage = message;
    this.messageStartTime = now;
    this.lastUpdate = now;
    return message;
  }

  /**
   * Reset the manager
   */
  reset(): void {
    this.currentMessage = '';
    this.messageStartTime = 0;
    this.lastUpdate = 0;
  }

  /**
   * Get elapsed time for current operation
   */
  getElapsedSeconds(): number {
    if (this.messageStartTime === 0) return 0;
    return Math.floor((Date.now() - this.messageStartTime) / 1000);
  }
}

/**
 * Format elapsed time for display
 */
export function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Determine if we should show detailed progress based on elapsed time
 */
export function shouldShowDetailedProgress(elapsedSeconds: number): boolean {
  return elapsedSeconds > 5;
}

/**
 * Get a contextual message for long-running operations
 */
export function getLongRunningMessage(elapsedSeconds: number, _intent: ClassifiedIntent): string {
  if (elapsedSeconds > 30) {
    return 'This is taking longer than expected, but I\'m still working on it...';
  }
  if (elapsedSeconds > 15) {
    return 'Complex request - still processing...';
  }
  return '';
}
