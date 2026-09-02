import { notFound, redirect } from 'next/navigation';
import { getApi, getBearer } from '@/lib/server/api';
import { PracticeRunner } from './runner';

export const dynamic = 'force-dynamic';

export default async function Practice({ params }: { params: { assignmentId: string } }) {
  const bearer = getBearer();
  if (!bearer) redirect('/welcome');

  let detail;
  try {
    // parent-preview or student — both hit the same authorize()-gated route
    detail = await getApi().getAssignmentDetail({ bearer, workspace: 'PARENT' }, params.assignmentId);
  } catch {
    try {
      detail = await getApi().getAssignmentDetail({ bearer, workspace: 'STUDENT' }, params.assignmentId);
    } catch {
      notFound();
    }
  }

  return <PracticeRunner assignmentId={params.assignmentId} detail={detail} />;
}
