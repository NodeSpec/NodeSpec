import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeEvent<T = any> {
  eventType: RealtimeEventType;
  new: T | null;
  old: T | null;
  table: string;
}

export interface SectionRealtimeEvent {
  id: string;
  specification_id: string;
  name: string;
  description: string | null;
  order_index: number;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

// R6 (Discovered #7): type now matches the live table — `priority` was a
// phantom (column dropped 20260126); locked/confirmed/architecture_trace
// were real columns the type omitted, which let the mapper strip them.
export interface RequirementRealtimeEvent {
  id: string;
  specification_id: string;
  requirement_id: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  acceptance_criteria: any;
  section_id: string | null;
  source: string;
  locked: boolean | null;
  confirmed: boolean | null;
  architecture_trace: string[] | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface MappingRealtimeEvent {
  id: string;
  specification_id: string;
  requirement_id: string | null;
  node_id: string;
  mapping_type: string;
  confidence: number;
  notes: string | null;
  is_orphan: boolean;
  last_validated_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface TestCaseRealtimeEvent {
  id: string;
  requirement_id: string;
  test_id: string;
  name: string;
  description: string | null;
  test_type: string;
  framework: string | null;
  status: string;
  implementation: string | null;
  expected_result: string | null;
  artifact_id: string | null;
  artifact_path: string | null;
  source_artifact_ids: string[] | null;
  source_context_hash: string | null;
  stale: boolean;
  staleness_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// R6: authored requirement↔requirement relations. The flagship flow is the
// user's AI recording lineage over MCP while the user watches the panel —
// INSERT/DELETE only (relations are add/remove facts; the table has no
// UPDATE policy).
export interface RelationRealtimeEvent {
  id: string;
  specification_id: string;
  from_requirement_id: string;
  to_requirement_id: string;
  relation_type: string;
  source: string;
  created_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface RealtimeCallbacks {
  onSectionChange?: (event: RealtimeEvent<SectionRealtimeEvent>) => void;
  onRequirementChange?: (event: RealtimeEvent<RequirementRealtimeEvent>) => void;
  onMappingChange?: (event: RealtimeEvent<MappingRealtimeEvent>) => void;
  onTestCaseChange?: (event: RealtimeEvent<TestCaseRealtimeEvent>) => void;
  onRelationChange?: (event: RealtimeEvent<RelationRealtimeEvent>) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface RealtimeSubscription {
  unsubscribe: () => void;
  isConnected: () => boolean;
}

export class SpecificationRealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(private supabase: SupabaseClient) {}

  subscribeToSpecification(
    specificationId: string,
    callbacks: RealtimeCallbacks,
    options?: { requirementIds?: string[] }
  ): RealtimeSubscription {
    const channelName = `specification:${specificationId}`;

    if (this.channels.has(channelName)) {
      console.warn(`Already subscribed to ${channelName}, unsubscribing first`);
      this.unsubscribe(channelName);
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'specification_sections',
          filter: `specification_id=eq.${specificationId}`,
        },
        (payload) => {
          if (callbacks.onSectionChange) {
            callbacks.onSectionChange({
              eventType: payload.eventType as RealtimeEventType,
              new: payload.new as SectionRealtimeEvent | null,
              old: payload.old as SectionRealtimeEvent | null,
              table: 'specification_sections',
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'specification_requirements',
          filter: `specification_id=eq.${specificationId}`,
        },
        (payload) => {
          if (callbacks.onRequirementChange) {
            callbacks.onRequirementChange({
              eventType: payload.eventType as RealtimeEventType,
              new: payload.new as RequirementRealtimeEvent | null,
              old: payload.old as RequirementRealtimeEvent | null,
              table: 'specification_requirements',
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'specification_mappings',
          filter: `specification_id=eq.${specificationId}`,
        },
        (payload) => {
          if (callbacks.onMappingChange) {
            callbacks.onMappingChange({
              eventType: payload.eventType as RealtimeEventType,
              new: payload.new as MappingRealtimeEvent | null,
              old: payload.old as MappingRealtimeEvent | null,
              table: 'specification_mappings',
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'specification_requirement_relations',
          filter: `specification_id=eq.${specificationId}`,
        },
        (payload) => {
          if (callbacks.onRelationChange) {
            callbacks.onRelationChange({
              eventType: payload.eventType as RealtimeEventType,
              new: payload.new as RelationRealtimeEvent | null,
              old: payload.old as RelationRealtimeEvent | null,
              table: 'specification_requirement_relations',
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'test_cases',
          ...(options?.requirementIds && options.requirementIds.length > 0
            ? { filter: `requirement_id=in.(${options.requirementIds.join(',')})` }
            : {}),
        },
        (payload) => {
          if (callbacks.onTestCaseChange) {
            callbacks.onTestCaseChange({
              eventType: payload.eventType as RealtimeEventType,
              new: payload.new as TestCaseRealtimeEvent | null,
              old: payload.old as TestCaseRealtimeEvent | null,
              table: 'test_cases',
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to ${channelName}`);
          this.reconnectAttempts.set(channelName, 0);
          if (callbacks.onConnectionChange) {
            callbacks.onConnectionChange(true);
          }
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`Channel error for ${channelName}`);
          if (callbacks.onError) {
            callbacks.onError(new Error(`Channel error for ${channelName}`));
          }
          this.handleReconnect(channelName, specificationId, callbacks);
        } else if (status === 'TIMED_OUT') {
          console.warn(`Subscription timed out for ${channelName}`);
          if (callbacks.onError) {
            callbacks.onError(new Error(`Subscription timed out for ${channelName}`));
          }
          this.handleReconnect(channelName, specificationId, callbacks);
        }
      });

    this.channels.set(channelName, channel);

    return {
      unsubscribe: () => this.unsubscribe(channelName),
      isConnected: () => {
        const ch = this.channels.get(channelName);
        return ch?.state === 'joined';
      },
    };
  }

  private handleReconnect(
    channelName: string,
    specificationId: string,
    callbacks: RealtimeCallbacks
  ): void {
    const attempts = this.reconnectAttempts.get(channelName) || 0;

    if (attempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnect attempts reached for ${channelName}`);
      if (callbacks.onError) {
        callbacks.onError(new Error(`Failed to reconnect after ${attempts} attempts`));
      }
      if (callbacks.onConnectionChange) {
        callbacks.onConnectionChange(false);
      }
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, attempts);
    console.log(`Reconnecting ${channelName} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(() => {
      this.reconnectAttempts.set(channelName, attempts + 1);
      this.unsubscribe(channelName);
      this.subscribeToSpecification(specificationId, callbacks);
    }, delay);
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      this.supabase.removeChannel(channel);
      this.channels.delete(channelName);
      this.reconnectAttempts.delete(channelName);
      console.log(`Unsubscribed from ${channelName}`);
    }
  }

  unsubscribeAll(): void {
    for (const channelName of this.channels.keys()) {
      this.unsubscribe(channelName);
    }
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.channels.keys());
  }

  isSubscribed(specificationId: string): boolean {
    const channelName = `specification:${specificationId}`;
    return this.channels.has(channelName);
  }
}
