// Publish dispatcher. One entry point for every destination, so callers only pass a channel id.

import { getChannel, validateChannel, type Channel } from '../channelStore';
import type { PublishRequest, PublishResult } from './types';
import { publishToEducative, testEducative } from './educative';
import { publishToWordPress, testWordPress } from './wordpress';
import { publishToDevTo, testDevTo } from './devto';
import { publishToSubstack, testSubstack } from './substack';

export type { PublishRequest, PublishResult } from './types';

export const CHANNEL_TYPE_LABELS: Record<Channel['type'], string> = {
  educative: 'Educative',
  wordpress: 'WordPress',
  devto: 'dev.to',
  substack: 'Substack',
};

export async function publishToChannel(
  channelId: string,
  req: Omit<PublishRequest, 'channel'>,
): Promise<PublishResult & { channelId: string; channelName: string; channelType: Channel['type'] }> {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Unknown publishing channel: ${channelId}`);
  validateChannel(channel);

  const full: PublishRequest = { ...req, channel };
  const result =
    channel.type === 'wordpress'
      ? await publishToWordPress(full)
      : channel.type === 'devto'
      ? await publishToDevTo(full)
      : channel.type === 'substack'
      ? await publishToSubstack(full)
      : await publishToEducative(full);

  return { ...result, channelId: channel.id, channelName: channel.name, channelType: channel.type };
}

export async function testChannel(channelId: string): Promise<{ ok: true; detail: string }> {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Unknown publishing channel: ${channelId}`);
  validateChannel(channel);
  if (channel.type === 'wordpress') return testWordPress(channel);
  if (channel.type === 'devto') return testDevTo(channel);
  if (channel.type === 'substack') return testSubstack(channel);
  return testEducative(channel);
}
