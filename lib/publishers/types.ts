// Shared contract for every publishing destination.

import type { Channel } from '../channelStore';

export interface PublishRequest {
  channel: Channel;
  /** Blog/newsletter title. */
  title: string;
  /** Rendered HTML with widgets inlined — the source of truth for WordPress. */
  html?: string;
  /** Raw markdown draft (still carries [code]/[table]/[image] tags). */
  markdown?: string;
  /** Educative editor blocks — only Educative consumes these. */
  blocks?: any[];
  /** Short summary used for excerpt / description. */
  summary?: string;
  /** URL slug hint. */
  slug?: string;
  /** Overrides the channel's default status (WordPress) / published flag (dev.to). */
  status?: string;
  /** Canonical URL to point syndicated copies back at. */
  canonicalUrl?: string;
  /** Local history record id, for recording the result. */
  blogId?: string;
  /**
   * Id this blog already has on the destination, from a previous publish. Present means
   * "update that item" rather than "create another one" — dev.to in particular will happily
   * create duplicate articles otherwise.
   */
  existingExternalId?: string;
  /**
   * Per-request Educative overrides. The newsletter page sets template/page type/categories
   * on the call rather than on a channel, so those keep taking precedence over channel config.
   */
  educative?: { templateId?: string; categories?: string; pageType?: 'blog' | 'newsletter' };
}

export interface PublishResult {
  /** Public (or editor) URL of the created item. */
  url: string;
  /** Destination-side identifier. */
  externalId?: string;
  /** How many images were uploaded to the destination. */
  mediaCount?: number;
  /** Non-fatal problems worth surfacing in the UI. */
  warnings?: string[];
  /** Extra destination-specific fields. */
  meta?: Record<string, any>;
}
