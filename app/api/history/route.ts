import { listBlogs } from '@/lib/storage';
import { isLive, reconcileOrphan } from '@/lib/runManager';

export const runtime = 'nodejs';

export async function GET() {
  let blogs = await listBlogs();
  // If a record says 'running' but no live handle exists (server restarted mid-run), flip it
  // to 'failed' so the History UI doesn't show a forever-spinning row.
  const orphans = blogs.filter((b) => b.status === 'running' && !isLive(b.id));
  if (orphans.length > 0) {
    await Promise.all(orphans.map((b) => reconcileOrphan(b.id).catch(() => {})));
    blogs = await listBlogs();
  }
  // Decorate running rows with `live` so the UI knows whether Stop will work.
  const decorated = blogs.map((b) => ({ ...b, live: b.status === 'running' && isLive(b.id) }));
  return Response.json({ blogs: decorated });
}
