import { redirect } from 'next/navigation';

export default function HistoryDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/blogs/${params.id}`);
}
