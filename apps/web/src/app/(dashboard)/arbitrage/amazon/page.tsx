import { redirect } from 'next/navigation';

export default function AmazonArbitrageRedirect() {
  redirect('/arbitrage?tab=bricklink');
}
