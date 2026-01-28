import { redirect } from 'next/navigation';

export default function EbayArbitrageRedirect() {
  redirect('/arbitrage?tab=ebay');
}
