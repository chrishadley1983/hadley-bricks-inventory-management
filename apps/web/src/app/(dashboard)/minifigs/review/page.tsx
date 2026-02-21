import { redirect } from 'next/navigation';

export default function MinifigReviewPage() {
  redirect('/minifigs?tab=review');
}
